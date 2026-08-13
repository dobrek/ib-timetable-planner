import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import type { GeneratedPlacement, GenerationResult, SolverTransport } from "@/entities/timetable";
import {
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan as createFactoryPlan,
  registerPlan,
  teardown,
} from "@/test/factories";
import { checkGeneration } from "./generation-delivery";
import { startGeneration } from "./generation-job";

/**
 * Delivery against the real local stack, with the SOLVER simulated by writing the row it would have
 * written. No CP-SAT here on purpose: a real solve is ~12 minutes (Phase 5 runs the true chain), and
 * everything this suite is about happens strictly AFTER the solver's terminal write.
 *
 * So the fixture is honest where it matters: the job row is created by the REAL enqueue path (so its
 * `snapshot` is a real assembled snapshot and its clone is a real `clone_plan` clone), and only the
 * `result`/`stages`/`status` columns are written by hand — exactly the three the service owns.
 *
 * The tiny topology (one course, one teacher, one student per cohort) is deliberate: the natural-key
 * translation and the region-replace are what is under test, and they are no more interesting at 84
 * courses than at two. Keeping it small also keeps the suite off the local stack's back.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

(hasEnv ? describe : describe.skip)("checkGeneration (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  /** A minimal two-cohort plan: each cohort gets one 1-hour course with a teacher and a student. */
  const tinyPlan = async (label: string): Promise<{ planId: string; dp1CourseId: string; dp2CourseId: string }> => {
    const planId = await createFactoryPlan(supabase, { name: `Delivery ${label} ${crypto.randomUUID()}` });
    const courseIds: Record<"dp1" | "dp2", string> = { dp1: "", dp2: "" };
    for (const cohort of ["dp1", "dp2"] as const) {
      const { teacherId } = await addTeacher(supabase, { planId, code: `T-${cohort}-${label}` });
      const { courseId } = await addCourse(supabase, {
        planId,
        cohort,
        name: `Course ${cohort}`,
        hoursPerWeek: 1,
        teacherIds: [teacherId],
      });
      await addStudentWithChoices(supabase, { planId, cohort, fullName: `S ${cohort}`, courseIds: [courseId] });
      courseIds[cohort] = courseId;
    }
    return { planId, dp1CourseId: courseIds.dp1, dp2CourseId: courseIds.dp2 };
  };

  /** Enqueue for real, then write the terminal row the solver would have written. */
  const solvedJob = async (
    planId: string,
    placements: GeneratedPlacement[],
    softHits = 0,
  ): Promise<{ jobId: string; proposalPlanId: string }> => {
    const { jobId, proposalPlanId } = await startGeneration(
      supabase,
      { planId },
      { getTransport: () => acceptingTransport },
    );
    registerPlan(proposalPlanId);

    const result: GenerationResult = {
      placements,
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 1234,
        partial: false,
        provenOptimal: true,
        cohorts: {
          dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
        },
      },
    };
    const { error } = await supabase
      .from("generation_jobs")
      .update({
        status: "succeeded",
        result,
        stages: [{ tier: 5, name: "softHits", status: "OPTIMAL", best: softHits, bound: softHits, wallClockS: 1 }],
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw new Error(`solvedJob: ${error.message}`);
    return { jobId, proposalPlanId };
  };

  const placementsOn = async (planId: string) =>
    (await supabase.from("placements").select("cohort, course_id, day, period, week").eq("plan_id", planId)).data ?? [];

  const jobRow = async (jobId: string) =>
    (
      await supabase
        .from("generation_jobs")
        .select("status, delivered_plan_id, proposal_plan_id, error")
        .eq("id", jobId)
        .single()
    ).data;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  it("verifies, translates the course ids, applies to the clone, and marks delivered", async () => {
    const { planId, dp1CourseId, dp2CourseId } = await tinyPlan("apply");
    const board: GeneratedPlacement[] = [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
      { cohort: "dp2", courseId: dp2CourseId, day: 2, period: 3, week: "both" },
    ];
    const { jobId, proposalPlanId } = await solvedJob(planId, board);

    const view = await checkGeneration(supabase, { planId });

    expect(view).toMatchObject({ jobId, status: "succeeded", delivered: true, proposalPlanId });
    expect(view?.cleanLabel).toEqual({ kind: "clean" });
    expect(await jobRow(jobId)).toMatchObject({ delivered_plan_id: proposalPlanId });

    // The board landed on the CLONE, under the clone's own course ids — never the source's.
    const applied = await placementsOn(proposalPlanId);
    expect(applied).toHaveLength(2);
    expect(applied.map((row) => row.course_id)).not.toContain(dp1CourseId);
    expect(applied.map((row) => ({ cohort: row.cohort, day: row.day, period: row.period })).sort(byCell)).toEqual(
      [
        { cohort: "dp1", day: 1, period: 1 },
        { cohort: "dp2", day: 2, period: 3 },
      ].sort(byCell),
    );

    // ...and the SOURCE plan is untouched. The whole point of a proposal.
    expect(await placementsOn(planId)).toHaveLength(0);
  });

  it("is idempotent: a second check delivers nothing further and reports the same state", async () => {
    const { planId, dp1CourseId } = await tinyPlan("idempotent");
    const { proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);

    const first = await checkGeneration(supabase, { planId });
    const second = await checkGeneration(supabase, { planId });

    expect(first?.delivered).toBe(true);
    expect(second).toMatchObject({ delivered: true, proposalPlanId });
    expect(await placementsOn(proposalPlanId)).toHaveLength(1);
  });

  it("delivers exactly once when two tabs check concurrently", async () => {
    // The on-visit trigger makes this the NORMAL case, not an edge one: two open tabs both fire on
    // mount. The delivered marker is a compare-and-set, so the loser simply reports the same state.
    const { planId, dp1CourseId } = await tinyPlan("concurrent");
    const { proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);

    const views = await Promise.all([
      checkGeneration(supabase, { planId }),
      checkGeneration(supabase, { planId }),
      checkGeneration(supabase, { planId }),
    ]);

    expect(views.every((view) => view?.delivered)).toBe(true);
    // One row, not three: a re-applied region replace converges rather than duplicating.
    expect(await placementsOn(proposalPlanId)).toHaveLength(1);
  });

  it("refuses a board the oracle rejects, fails the job, and removes the orphan clone", async () => {
    // Two courses sharing a teacher, dropped into the same cell — a blocking collision the oracle
    // must catch. An unverified board must never reach a proposal plan.
    const planId = await createFactoryPlan(supabase, { name: `Delivery reject ${crypto.randomUUID()}` });
    const { teacherId } = await addTeacher(supabase, { planId, code: `T-shared-${crypto.randomUUID()}` });
    const courses = await Promise.all(
      ["A", "B"].map(async (name) => {
        const { courseId } = await addCourse(supabase, {
          planId,
          cohort: "dp1",
          name,
          hoursPerWeek: 1,
          teacherIds: [teacherId],
        });
        await addStudentWithChoices(supabase, { planId, cohort: "dp1", fullName: `S ${name}`, courseIds: [courseId] });
        return courseId;
      }),
    );
    const { jobId, proposalPlanId } = await solvedJob(
      planId,
      courses.map((courseId) => ({ cohort: "dp1" as const, courseId, day: 1, period: 1, week: "both" as const })),
    );

    const view = await checkGeneration(supabase, { planId });

    expect(view).toMatchObject({ status: "failed", delivered: false, proposalPlanId: null });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", delivered_plan_id: null });
    expect((await jobRow(jobId))?.error).toMatch(/did not pass verification/);
    // The clone is gone, so nothing half-generated is left on the plans list.
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("sweeps the orphan clone of a job that failed in the solver", async () => {
    const { planId } = await tinyPlan("solver-failed");
    const { jobId, proposalPlanId } = await solvedJob(planId, []);
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error: "infeasible: the snapshot admits no complete board" })
      .eq("id", jobId);

    const view = await checkGeneration(supabase, { planId });

    expect(view).toMatchObject({ status: "failed", proposalPlanId: null });
    expect(view?.error).toMatch(/infeasible/);
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("reports an active job without touching the proposal", async () => {
    const { planId } = await tinyPlan("active");
    const { proposalPlanId } = await startGeneration(supabase, { planId }, { getTransport: () => acceptingTransport });
    registerPlan(proposalPlanId);

    const view = await checkGeneration(supabase, { planId });

    expect(view).toMatchObject({ status: "queued", delivered: false, proposalPlanId });
    expect(view?.cleanLabel).toEqual({ kind: "unavailable" });
    expect(await placementsOn(proposalPlanId)).toHaveLength(0);
  });

  it("returns null for a plan that has never been generated", async () => {
    const planId = await createFactoryPlan(supabase, { name: `Delivery none ${crypto.randomUUID()}` });

    expect(await checkGeneration(supabase, { planId })).toBeNull();
  });
});

const byCell = (a: { cohort: string; day: number }, b: { cohort: string; day: number }): number =>
  a.cohort.localeCompare(b.cohort) || a.day - b.day;
