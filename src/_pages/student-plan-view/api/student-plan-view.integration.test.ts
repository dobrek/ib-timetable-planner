import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { addMerge, addStudentWithChoices, createPlan, placeCourse, teardown } from "@/test/factories";
import { loadStudentPlanView } from "./loader";

// Local-only (service_role/secret key, bypasses RLS); skips when the env/stack is absent.
// Builds a small bespoke two-cohort scenario (merge + cross-cohort sibling) instead of the
// full CSV seed, so the cohort-scoping and merge edges are exactly known. Torn down once
// at the end. Mirrors teacher-plan-view.integration.test.ts.

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

(hasEnv ? describe : describe.skip)("loadStudentPlanView", () => {
  it("returns the single-cohort dataset with the switcher list, cohort-scoped catalog/placements, merges, and teacher names", async () => {
    const { planId, scenario } = await buildScenario();

    const result = await loadStudentPlanView(supabase, planId, scenario.s1);
    if (!result.ok) throw new Error(`loadStudentPlanView failed: ${JSON.stringify(result.error)}`);
    const data = result.value;

    // Student identity + the switcher list covering BOTH cohorts' students.
    expect(data.student).toEqual({ id: scenario.s1, fullName: "Student One", cohort: "dp1" });
    expect(new Set(data.students.map((student) => student.id))).toEqual(
      new Set([scenario.s1, scenario.s2, scenario.dp2Student]),
    );
    expect(data.students.find((student) => student.id === scenario.dp2Student)?.cohort).toBe("dp2");

    // Cohort scoping: the dp1 catalog/placements only — the dp2 course never appears.
    const courseIds = new Set(data.courses.map((course) => course.id));
    expect(courseIds.has(scenario.courseA)).toBe(true);
    expect(courseIds.has(scenario.dp2Course)).toBe(false);
    expect(data.placements.some((placement) => placement.courseId === scenario.dp2Course)).toBe(false);
    expect(Object.keys(data.courseInfo)).not.toContain(scenario.dp2Course);

    // Junction membership: S1 chose A and the merge child C1; the merge relation is exposed
    // so the course list resolves the child through its parent's placement.
    const courseA = data.courses.find((course) => course.id === scenario.courseA);
    expect(courseA?.studentKeys).toContain(scenario.s1);
    expect(data.merges).toEqual(expect.arrayContaining([{ parentId: scenario.parentP, childId: scenario.childC1 }]));

    // Placements carry their week; teacher names resolve for the card rosters.
    const placementA = data.placements.find((placement) => placement.courseId === scenario.courseA);
    expect(placementA?.week).toBe("a");
    expect(data.teacherNames[scenario.t1]).toBe("Teacher One");
  });

  it("returns not-found for a student of another plan and for a malformed student id", async () => {
    const { planId } = await buildScenario();
    const otherPlanId = await createPlan(supabase, { name: "Student View Other Plan" });
    const { studentId: foreignStudent } = await addStudentWithChoices(supabase, {
      planId: otherPlanId,
      cohort: "dp1",
      fullName: "Foreign Student",
      courseIds: [],
    });

    expect(await loadStudentPlanView(supabase, planId, foreignStudent)).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
    expect(await loadStudentPlanView(supabase, planId, "not-a-uuid")).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
    expect(await loadStudentPlanView(supabase, "not-a-uuid", foreignStudent)).toEqual({
      ok: false,
      error: { kind: "not-found" },
    });
  });
});

type Scenario = {
  t1: string;
  courseA: string;
  parentP: string;
  childC1: string;
  dp2Course: string;
  s1: string;
  s2: string;
  dp2Student: string;
};

/**
 * A minimal two-cohort scenario: in dp1, T1 teaches A (placed on week "a") and the merged
 * session P (child C1); S1 chooses A + C1, S2 chooses only A. In dp2, one course and one
 * student exist purely as cohort-scoping and switcher-list probes.
 */
async function buildScenario(): Promise<{ planId: string; scenario: Scenario }> {
  const planId = await createPlan(supabase, { name: "Student View Scenario" });
  const t1 = await insertTeacher(planId, "T1", "Teacher One");

  const courseA = await insertCourse(planId, "dp1", "Alpha", [t1]);
  const parentP = await insertCourse(planId, "dp1", "Merged Parent", [t1]);
  const childC1 = await insertCourse(planId, "dp1", "Child One", [t1]);
  const dp2Course = await insertCourse(planId, "dp2", "Beta Two", [t1]);
  await addMerge(supabase, { planId, parentCourseId: parentP, childCourseId: childC1 });

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
    courseIds: [courseA],
  });
  const { studentId: dp2Student } = await addStudentWithChoices(supabase, {
    planId,
    cohort: "dp2",
    fullName: "Student Deux",
    courseIds: [dp2Course],
  });

  await placeCourse(supabase, { planId, cohort: "dp1", courseId: courseA, day: 1, period: 1, week: "a" });
  await placeCourse(supabase, { planId, cohort: "dp1", courseId: parentP, day: 2, period: 3 });
  await placeCourse(supabase, { planId, cohort: "dp2", courseId: dp2Course, day: 1, period: 1 });

  return { planId, scenario: { t1, courseA, parentP, childC1, dp2Course, s1, s2, dp2Student } };
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

async function insertCourse(
  planId: string,
  cohort: "dp1" | "dp2",
  name: string,
  teacherIds: string[],
): Promise<string> {
  const { data, error } = await supabase
    .from("courses")
    .insert({ plan_id: planId, cohort, name, level: "SL", hours_per_week: 2 })
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
