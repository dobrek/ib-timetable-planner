import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { buildPerspectiveCourseItems, deriveHours, teacherCourses } from "@/entities/timetable";
import { addAvailability, addMerge, addStudentWithChoices, createPlan, placeCourse, teardown } from "@/test/factories";
import { loadTeacherPlanView, type TeacherPlanViewData } from "./loader";

// Local-only (service_role/secret key, bypasses RLS); skips when the env/stack is absent.
// Builds a small bespoke scenario (co-teaching + merge + availability) instead of the full
// CSV seed, so the merge/roster edges are exactly known. Torn down once at the end.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

let supabase: SupabaseClient<Database>;

beforeAll(() => {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
});

afterAll(async () => {
  await teardown(supabase);
});

(hasEnv ? describe : describe.skip)("loadTeacherPlanView", () => {
  it("returns the full teacher-view dataset with junction-filtered courses, merge relations, rosters, weeks, and availability", async () => {
    const { planId, t1, scenario } = await buildScenario();

    const result = await loadTeacherPlanView(supabase, planId, t1);
    if (!result.ok) throw new Error(`loadTeacherPlanView failed: ${JSON.stringify(result.error)}`);
    const data = result.value;

    // Teacher identity + the switcher list covering every plan teacher.
    expect(data.teacher.id).toBe(t1);
    expect(new Set(data.teachers.map((teacher) => teacher.id))).toEqual(new Set([t1, scenario.t2]));

    // Junction membership is the filter oracle: T1 conducts A, the merge parent P, and both
    // children (identical teacher sets); B belongs to T2 only and never enters T1's set.
    const mineIds = new Set(teacherCourses(data.dp1.courses, t1).map((course) => course.id));
    expect(mineIds).toEqual(new Set([scenario.courseA, scenario.parentP, scenario.childC1, scenario.childC2]));
    expect(mineIds.has(scenario.courseB)).toBe(false);

    // Placements carry their week (A was placed on week "a").
    const placementA = data.dp1.placements.find((placement) => placement.courseId === scenario.courseA);
    expect(placementA?.week).toBe("a");

    // The merge relation is exposed for composite resolution.
    expect(data.merges).toEqual(
      expect.arrayContaining([
        { parentId: scenario.parentP, childId: scenario.childC1 },
        { parentId: scenario.parentP, childId: scenario.childC2 },
      ]),
    );

    // Availability cells arrive serializable and teacher-keyed.
    expect(data.availability).toEqual(
      expect.arrayContaining([{ teacherKey: t1, day: 1, period: 2, severity: "strong" }]),
    );

    assertMergeResolvesToChildrenWithOwnRosters(data, t1, scenario);
  });

  it("returns not-found for a teacher of another plan and for a malformed teacher id", async () => {
    const { planId } = await buildScenario();
    const otherPlanId = await createPlan(supabase, { name: "Teacher View Other Plan" });
    const foreignTeacher = await insertTeacher(otherPlanId, "ZZ", "Foreign Teacher");

    expect(await loadTeacherPlanView(supabase, planId, foreignTeacher)).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
    expect(await loadTeacherPlanView(supabase, planId, "not-a-uuid")).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
  });
});

/**
 * The merge contract: the course list resolves the composite parent to its real children,
 * each with its OWN roster; the children's occurrence times are the parent's placements.
 */
function assertMergeResolvesToChildrenWithOwnRosters(data: TeacherPlanViewData, t1: string, scenario: Scenario): void {
  const items = buildPerspectiveCourseItems({
    cohort: "dp1",
    courses: data.dp1.courses,
    placements: data.dp1.placements,
    merges: data.merges,
    hours: deriveHours(data.dp1.placements, data.dp1.courses),
    memberOf: (candidate) => candidate.teacherKeys.includes(t1),
  });

  const ids = items.map((item) => item.courseId);
  expect(ids).toEqual(expect.arrayContaining([scenario.courseA, scenario.childC1, scenario.childC2]));
  expect(ids).not.toContain(scenario.parentP);

  const c1 = items.find((item) => item.courseId === scenario.childC1);
  const c2 = items.find((item) => item.courseId === scenario.childC2);
  // Separate rosters: C1 carries S1's choice, C2 carries S2's; C2 has no direct choices
  // in the catalog only when unchosen — here both are chosen, distinctly.
  expect(c1?.studentKeys).toEqual([scenario.s1]);
  expect(c2?.studentKeys).toEqual([scenario.s2]);
  // Both children are scheduled by the parent's single block.
  expect(c1?.occurrences.map(occurrenceCell)).toEqual([{ day: 2, period: 3 }]);
  expect(c2?.occurrences.map(occurrenceCell)).toEqual([{ day: 2, period: 3 }]);
}

const occurrenceCell = (occurrence: { day: number; period: number }) => ({
  day: occurrence.day,
  period: occurrence.period,
});

type Scenario = {
  t2: string;
  courseA: string;
  courseB: string;
  parentP: string;
  childC1: string;
  childC2: string;
  s1: string;
  s2: string;
};

/**
 * A minimal dp1 scenario: T1 teaches A and the merged session P (children C1, C2 share
 * T1's teacher set); T2 teaches B. S1 chooses A + C1, S2 chooses C2. A is placed on
 * week "a"; P occupies one block. T1 carries one strong availability block.
 */
async function buildScenario(): Promise<{ planId: string; t1: string; scenario: Scenario }> {
  const planId = await createPlan(supabase, { name: "Teacher View Scenario" });
  const t1 = await insertTeacher(planId, "T1", "Teacher One");
  const t2 = await insertTeacher(planId, "T2", "Teacher Two");

  const courseA = await insertCourse(planId, "Alpha", [t1]);
  const courseB = await insertCourse(planId, "Beta", [t2]);
  const parentP = await insertCourse(planId, "Merged Parent", [t1]);
  const childC1 = await insertCourse(planId, "Child One", [t1]);
  const childC2 = await insertCourse(planId, "Child Two", [t1]);
  await addMerge(supabase, { planId, parentCourseId: parentP, childCourseId: childC1 });
  await addMerge(supabase, { planId, parentCourseId: parentP, childCourseId: childC2 });

  const { studentId: s1 } = await addStudentWithChoices(supabase, {
    planId,
    cohort: "dp1",
    fullName: "Student One",
    courseIds: [courseA, childC1],
  });
  const { studentId: s2 } = await addStudentWithChoices(supabase, {
    planId,
    cohort: "dp1",
    fullName: "Student Two",
    courseIds: [childC2],
  });

  await placeCourse(supabase, { planId, cohort: "dp1", courseId: courseA, day: 1, period: 1, week: "a" });
  await placeCourse(supabase, { planId, cohort: "dp1", courseId: parentP, day: 2, period: 3 });
  await addAvailability(supabase, { planId, teacherId: t1, day: 1, period: 2, severity: "strong" });

  return { planId, t1, scenario: { t2, courseA, courseB, parentP, childC1, childC2, s1, s2 } };
}

async function insertTeacher(planId: string, code: string, fullName: string): Promise<string> {
  const { data, error } = await supabase
    .from("teachers")
    .insert({ plan_id: planId, code, full_name: fullName })
    .select("id")
    .single();
  if (error) throw new Error(`insertTeacher: ${error.message}`);
  return data.id;
}

async function insertCourse(planId: string, name: string, teacherIds: string[]): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .insert({ plan_id: planId, cohort: "dp1", name, level: "SL", hours_per_week: 2 })
    .select("id")
    .single();
  if (error) throw new Error(`insertCourse: ${error.message}`);
  const links = teacherIds.map((teacherId) => ({ plan_id: planId, course_id: data.id, teacher_id: teacherId }));
  if (links.length > 0) {
    const { error: linkError } = await supabase.from("course_teachers").insert(links);
    if (linkError) throw new Error(`insertCourse links: ${linkError.message}`);
  }
  return data.id;
}
