import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  addCourse,
  addMerge,
  addOverlap,
  addStudentWithChoices,
  addTeacher,
  createPlan,
  teardown,
} from "@/test/factories";
import { loadCohortCourses } from "./load-cohort-courses";

/**
 * The catalog projection against the real loader + real Postgres — the seam where the Chemistry
 * completeness gap lived. Each case builds its own bare topology through the factories (no CSV
 * catalog), asserts, and tears the plan down.
 *
 * The rule under test: **overlap rows mean a combined session**, so an overlap base survives the
 * projection whenever a dependent carries students — with the base's own `hours_per_week` (the
 * session's real teaching hours) and the dependents' roster folded in. A base whose dependents are
 * all empty is not taught at all and stays dropped.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("loadCohortCourses projection (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("keeps a zero-enrolment overlap base whose dependent has students (the combined session)", async () => {
    const planId = await createPlan(supabase, { name: "Projection — live overlap base" });
    const { teacherId } = await addTeacher(supabase, { planId, code: "CH" });
    // The dp1 Chemistry topology, exactly: a 4 h SL base nobody picks directly, taught together
    // with the 2 h HL dependent its students do pick.
    const { courseId: base } = await addCourse(supabase, {
      planId,
      cohort: "dp1",
      name: "Chemistry",
      level: "SL",
      hoursPerWeek: 4,
      teacherIds: [teacherId],
    });
    const { courseId: dependent } = await addCourse(supabase, {
      planId,
      cohort: "dp1",
      name: "Chemistry",
      level: "HL",
      hoursPerWeek: 2,
      teacherIds: [teacherId],
    });
    await addOverlap(supabase, { planId, baseCourseId: base, dependentCourseId: dependent });
    const students = await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        addStudentWithChoices(supabase, {
          planId,
          cohort: "dp1",
          fullName: `Chem Student ${index}`,
          courseIds: [dependent],
        }),
      ),
    );
    const studentIds = students.map(({ studentId }) => studentId).sort();

    const { courses, warnings } = await loadCohortCourses(supabase, planId, "dp1");

    // Both halves of the session are projected — the whole 6 taught hours are now visible.
    expect(courses.map((course) => course.id).sort()).toEqual([base, dependent].sort());
    expect(courses.find((course) => course.id === base)?.hours).toBe(4);
    expect(courses.find((course) => course.id === dependent)?.hours).toBe(2);
    // ... and both carry the same roster: the base's students come from the fold.
    for (const course of courses) expect([...course.studentKeys].sort()).toEqual(studentIds);
    // The base is not a `no-students` anomaly — its roster is non-empty via the fold.
    expect(warnings).toEqual([]);
  });

  it("drops an overlap base whose dependents carry no students", async () => {
    const planId = await createPlan(supabase, { name: "Projection — dead overlap base" });
    const { teacherId } = await addTeacher(supabase, { planId, code: "PH" });
    const { courseId: base } = await addCourse(supabase, {
      planId,
      cohort: "dp1",
      name: "Physics",
      level: "SL",
      hoursPerWeek: 4,
      teacherIds: [teacherId],
    });
    const { courseId: dependent } = await addCourse(supabase, {
      planId,
      cohort: "dp1",
      name: "Physics",
      level: "HL",
      hoursPerWeek: 2,
      teacherIds: [teacherId],
    });
    await addOverlap(supabase, { planId, baseCourseId: base, dependentCourseId: dependent });

    const { courses } = await loadCohortCourses(supabase, planId, "dp1");

    // Nobody is enrolled in either half — the session is not taught, so neither course projects.
    expect(courses).toEqual([]);
  });

  it("leaves merge topologies unchanged (parent once, children beside it)", async () => {
    const planId = await createPlan(supabase, { name: "Projection — merge unchanged" });
    const { teacherId } = await addTeacher(supabase, { planId, code: "MA" });
    const { courseId: parent } = await addCourse(supabase, {
      planId,
      cohort: "dp2",
      name: "Math AA",
      level: "HL",
      hoursPerWeek: 5,
      teacherIds: [teacherId],
    });
    const { courseId: child } = await addCourse(supabase, {
      planId,
      cohort: "dp2",
      name: "Math AA",
      level: "HL",
      groupIndex: 1,
      hoursPerWeek: 0,
      teacherIds: [teacherId],
    });
    await addMerge(supabase, { planId, parentCourseId: parent, childCourseId: child });
    const { studentId } = await addStudentWithChoices(supabase, {
      planId,
      cohort: "dp2",
      fullName: "Merge Student",
      courseIds: [child],
    });

    const { courses, warnings } = await loadCohortCourses(supabase, planId, "dp2");

    // The parent is virtual (its roster is the union of its children's); the child projects too,
    // carrying 0 standalone hours — unchanged by the overlap-base rule.
    const projected = courses.find((course) => course.id === parent);
    expect(projected?.hours).toBe(5);
    expect(projected?.studentKeys).toEqual([studentId]);
    expect(courses.filter((course) => course.id === parent)).toHaveLength(1);
    expect(courses.find((course) => course.id === child)?.hours).toBe(0);
    // A merge child legitimately carries 0 standalone hours — no `zero-hours` anomaly.
    expect(warnings).toEqual([]);
  });
});
