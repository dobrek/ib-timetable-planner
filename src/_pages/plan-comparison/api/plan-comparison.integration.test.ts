import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { analyzePlan, verifyGeneration } from "@/entities/timetable";
import {
  addAvailability,
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan,
  placeCourse,
  teardown,
} from "@/test/factories";
import { loadPlanAnalysis } from "./load-plan-analysis";

/**
 * The loader is the only part of the comparison feature with real failure modes — ~15 round trips
 * across two waves, a widened catalog projection, and two consumers (the bench CLI and the in-app
 * surface) that must never disagree. So it is tested against the real stack.
 *
 * Local-only (service_role key, bypasses RLS); skips when the env/stack is absent. State is built
 * through `src/test/factories/` and torn down at the end — never asserted against the shared dev seed.
 */
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

(hasEnv ? describe : describe.skip)("loadPlanAnalysis", () => {
  it("loads a well-formed analyzer input, resolving natural keys and feeding both the extractor and the oracle", async () => {
    const scenario = await buildScenario();

    const plan = await loadPlanAnalysis(supabase, scenario.planId);

    // Plan identity + the parsed grid the drift tier compares on.
    expect(plan.id).toBe(scenario.planId);
    expect(plan.input.days).toBe(5);
    expect(plan.input.periods).toBe(10);

    // The analyzer input carries the course catalog with its subject identity joined on — the
    // `courseIdentity` side-set, which replaced this loader's second `courses` query.
    const maths = plan.input.courses.dp1.find((course) => course.id === scenario.maths);
    expect(maths).toMatchObject({ name: "Maths", level: "HL", groupIndex: 5, hours: 2 });
    expect(maths?.studentKeys).toEqual([scenario.student]);
    expect(maths?.teacherKeys).toEqual([scenario.teacher]);

    // The board arrives as engine-shaped rows, cohort-tagged.
    expect(plan.board).toEqual(
      expect.arrayContaining([expect.objectContaining({ cohort: "dp1", courseId: scenario.maths, day: 1, period: 1 })]),
    );

    // Availability rides along, teacher-keyed.
    expect(plan.input.availability).toEqual(
      expect.arrayContaining([{ teacherKey: scenario.teacher, day: 2, period: 4, severity: "soft" }]),
    );

    // Natural keys resolve — the fingerprint hashes these, and the scoreboard renders its extremes
    // through them. This is what turns a worst-teacher UUID into a name.
    expect(plan.naturalKeys.teachers[scenario.teacher]).toEqual({ code: "AB", fullName: "Ada Byron" });
    expect(plan.naturalKeys.students[scenario.student]).toBe("Alan Turing");

    // Catalog anomalies are surfaced, not swallowed: the zero-hours course reads as "complete"
    // downstream unless it is named beside the numbers.
    expect(plan.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ cohort: "dp1", kind: "zero-hours" })]),
    );

    // Both downstream consumers accept the loaded plan: the oracle judges the board, and the
    // extractor folds it into a feature vector.
    const verdict = verifyGeneration(plan.snapshot, plan.board);
    expect(typeof verdict.ok).toBe("boolean");
    expect(verdict.softWarnCount).toBeGreaterThanOrEqual(0);

    const features = analyzePlan(plan.input);
    expect(features.cohorts.dp1.board.placementRows).toBe(2);
    expect(features.cohorts.dp1.completeness.uncataloguedRows).toBe(0);
  });

  it("throws a plan-id-naming error for a plan that does not exist", async () => {
    await expect(loadPlanAnalysis(supabase, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });
});

type Scenario = {
  planId: string;
  teacher: string;
  student: string;
  maths: string;
};

/**
 * A minimal dp1 plan: one teacher, a 2-hour Maths HL placed twice, and a deliberately zero-hours
 * course so the loader's `warnings` pass-through is exercised on real data rather than asserted
 * vacuously.
 */
async function buildScenario(): Promise<Scenario> {
  const planId = await createPlan(supabase, { name: "Comparison Loader Scenario" });
  const { teacherId } = await addTeacher(supabase, { planId, code: "AB", fullName: "Ada Byron" });

  const { courseId: maths } = await addCourse(supabase, {
    planId,
    cohort: "dp1",
    name: "Maths",
    level: "HL",
    groupIndex: 5,
    hoursPerWeek: 2,
    teacherIds: [teacherId],
  });
  const { courseId: ghost } = await addCourse(supabase, {
    planId,
    cohort: "dp1",
    name: "Theory of Knowledge",
    level: "none",
    hoursPerWeek: 0,
    teacherIds: [teacherId],
  });

  const { studentId } = await addStudentWithChoices(supabase, {
    planId,
    cohort: "dp1",
    fullName: "Alan Turing",
    courseIds: [maths, ghost],
  });

  await placeCourse(supabase, { planId, cohort: "dp1", courseId: maths, day: 1, period: 1 });
  await placeCourse(supabase, { planId, cohort: "dp1", courseId: maths, day: 3, period: 2 });
  await addAvailability(supabase, { planId, teacherId, day: 2, period: 4, severity: "soft" });

  return { planId, teacher: teacherId, student: studentId, maths };
}
