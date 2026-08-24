import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  HEARTBEAT_GRACE_MS,
  type GeneratedPlacement,
  type GenerationResult,
  type SolverTransport,
} from "@/entities/timetable";
import { checkGeneration, startGeneration } from "@/_pages/plan-detail/api";
import { addCourse, addStudentWithChoices, addTeacher, createPlan, registerPlan, teardown } from "@/test/factories";

/**
 * S-304's app half against the real stack: what happens to a job whose solver died without saying so.
 *
 * **No solver, on purpose.** Every failure this suite is about happens strictly after the container
 * stopped existing — a hard kill writes nothing, which is the whole point — so the fixture writes the
 * row a dead solve would have left behind and then drives the two recovery paths that exist:
 * `checkGeneration` (the plan visit, authoritative, and the one that also delivers the checkpoint) and
 * `startGeneration`'s `23505` backstop (the author who clicks Generate without opening the plan).
 *
 * **The parts that must be real are real.** The plan, its catalog, the clone and the job's `snapshot`
 * all come from the actual enqueue path, so the checkpoint delivered here goes through the same
 * `runVerifiedGeneration` → `translateCourseIds` → `applyToProposal` chain a production board does —
 * including the natural-key translation onto ids `clone_plan` re-minted. Only the columns the solver
 * owns (`status`, `heartbeat_at`, `checkpoint`, `checkpoint_stage_index`) are written by hand.
 *
 * The fifth case is the one that keeps the other four honest: a HEALTHY running job must survive both
 * paths untouched. A reclaim is a write, and the objection this design had to answer (S-301's review)
 * was precisely that a wrong threshold fails live jobs.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

/** Comfortably past the grace, so no clock skew between the test and the database can matter. */
const LONG_DEAD = (): string => new Date(Date.now() - HEARTBEAT_GRACE_MS * 2).toISOString();

(hasEnv ? describe : describe.skip)("generation lifecycle recovery (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  /** A minimal two-cohort plan: each cohort gets one 1-hour course with a teacher and a student. */
  const tinyPlan = async (label: string) => {
    const planId = await createPlan(supabase, { name: `Lifecycle ${label} ${crypto.randomUUID()}` });
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
    return { planId, board: boardFor(courseIds) };
  };

  /**
   * Enqueue for real, then leave the row exactly as a container that was killed mid-solve would have:
   * `running`, a heartbeat that stopped renewing, and whatever the last completed stage checkpointed.
   */
  const wedgedJob = async (
    planId: string,
    options: { checkpoint?: GeneratedPlacement[]; heartbeatAt?: string | null; status?: "running" | "queued" } = {},
  ) => {
    const { jobId, proposalPlanId } = await startGeneration(
      supabase,
      { planId },
      { getTransport: () => acceptingTransport },
    );
    registerPlan(proposalPlanId);

    const status = options.status ?? "running";
    const { error } = await supabase
      .from("generation_jobs")
      .update({
        status,
        started_at: status === "running" ? LONG_DEAD() : null,
        heartbeat_at: options.heartbeatAt === undefined ? LONG_DEAD() : options.heartbeatAt,
        ...(options.checkpoint ? { checkpoint: checkpointResult(options.checkpoint), checkpoint_stage_index: 3 } : {}),
        // A partial transcript, as a stage-3 stop would leave: no tier 5, which is exactly why the
        // clean label for a delivered partial board honestly degrades to `unavailable`.
        stages: [{ tier: 3, name: "totalSlots", status: "FEASIBLE", best: 12, bound: 10, wallClockS: 4.2 }],
      })
      .eq("id", jobId);
    if (error) throw new Error(`wedgedJob: ${error.message}`);
    return { jobId, proposalPlanId };
  };

  /** A `queued` row is stranded by `created_at`, which is the only clock it has. */
  const strandedQueuedJob = async (planId: string) => {
    const wedged = await wedgedJob(planId, { status: "queued", heartbeatAt: null });
    const { error } = await supabase.from("generation_jobs").update({ created_at: LONG_DEAD() }).eq("id", wedged.jobId);
    if (error) throw new Error(`strandedQueuedJob: ${error.message}`);
    return wedged;
  };

  const jobRow = async (jobId: string) =>
    (
      await supabase
        .from("generation_jobs")
        .select("status, error, delivered_plan_id, proposal_plan_id, checkpoint_stage_index, finished_at")
        .eq("id", jobId)
        .single()
    ).data;

  const planExists = async (planId: string): Promise<boolean> =>
    ((await supabase.from("plans").select("id").eq("id", planId).maybeSingle()).data ?? null) !== null;

  const placementsOn = async (planId: string) =>
    (await supabase.from("placements").select("cohort, course_id, day, period, week").eq("plan_id", planId)).data ?? [];

  it("reclaims a dead running job and delivers its checkpoint in the same visit", async () => {
    const { planId, board } = await tinyPlan("deliver");
    const { jobId, proposalPlanId } = await wedgedJob(planId, { checkpoint: board });

    const view = await checkGeneration(supabase, { planId });

    // One visit did both halves: the CAS runs ahead of the delivery branch precisely so the author
    // does not have to come back a second time to collect a board that was already durable.
    expect(view).toMatchObject({ jobId, status: "interrupted", delivered: true, checkpointStageIndex: 3 });
    expect(view?.error).toMatch(/the solver stopped reporting/);
    expect(await jobRow(jobId)).toMatchObject({ status: "interrupted", delivered_plan_id: proposalPlanId });

    // The partial board landed on the clone, under the CLONE's re-minted course ids.
    const applied = await placementsOn(proposalPlanId);
    expect(applied).toHaveLength(2);
    const sourceCourseIds = new Set(board.map((row) => row.courseId));
    expect(applied.every((row) => !sourceCourseIds.has(row.course_id))).toBe(true);

    // A partial transcript never reached tier 5, so claiming anything about soft hits would be a
    // guess. `unavailable` is the honest label, and it falls out of the existing derivation.
    expect(view?.cleanLabel).toEqual({ kind: "unavailable" });

    // The source plan is untouched — the whole promise of a proposal, partial or not.
    expect(await placementsOn(planId)).toHaveLength(0);
  });

  it("reclaims a dead running job with nothing kept and sweeps its orphan clone", async () => {
    const { planId } = await tinyPlan("sweep");
    const { jobId, proposalPlanId } = await wedgedJob(planId);

    const view = await checkGeneration(supabase, { planId });

    expect(view).toMatchObject({ jobId, status: "interrupted", delivered: false, checkpointStageIndex: null });
    // The clone can only ever be litter: nothing will be delivered onto it, and leaving it would put
    // a half-made proposal in the plans list forever.
    expect(view?.proposalPlanId).toBeNull();
    expect(await planExists(proposalPlanId)).toBe(false);
  });

  it("recovers at the enqueue conflict when the author never opened the plan", async () => {
    const { planId } = await tinyPlan("enqueue");
    const { jobId: deadJobId, proposalPlanId: deadClone } = await wedgedJob(planId);

    // The partial unique index refuses this insert; the 23505 backstop reclaims the blocker and
    // retries exactly once.
    const started = await startGeneration(supabase, { planId }, { getTransport: () => acceptingTransport });
    registerPlan(started.proposalPlanId);

    expect(started.jobId).not.toBe(deadJobId);
    expect(await jobRow(started.jobId)).toMatchObject({ status: "queued" });
    expect(await jobRow(deadJobId)).toMatchObject({ status: "interrupted" });
    // No checkpoint on the dead job, so its clone went the way a failed job's does.
    expect(await planExists(deadClone)).toBe(false);
  });

  it("recovers a stranded queued row the same way, measured from created_at", async () => {
    const { planId } = await tinyPlan("stranded");
    const { jobId: strandedJobId } = await strandedQueuedJob(planId);

    const started = await startGeneration(supabase, { planId }, { getTransport: () => acceptingTransport });
    registerPlan(started.proposalPlanId);

    expect(await jobRow(strandedJobId)).toMatchObject({ status: "interrupted" });
    expect(await jobRow(started.jobId)).toMatchObject({ status: "queued" });
  });

  it("leaves a healthy running job alone on BOTH paths", async () => {
    const { planId } = await tinyPlan("healthy");
    const { jobId } = await wedgedJob(planId, { heartbeatAt: new Date().toISOString() });

    // The visit reads and returns; it must not write.
    const view = await checkGeneration(supabase, { planId });
    expect(view).toMatchObject({ jobId, status: "running" });
    expect(await jobRow(jobId)).toMatchObject({ status: "running", finished_at: null });

    // And a second Generate is still refused, because a live job really is running.
    await expect(startGeneration(supabase, { planId }, { getTransport: () => acceptingTransport })).rejects.toThrow(
      /already running/,
    );
    expect(await jobRow(jobId)).toMatchObject({ status: "running" });
  });
});

const boardFor = (courseIds: Record<"dp1" | "dp2", string>): GeneratedPlacement[] => [
  { cohort: "dp1", courseId: courseIds.dp1, day: 1, period: 1, week: "both" },
  { cohort: "dp2", courseId: courseIds.dp2, day: 2, period: 3, week: "both" },
];

/** The shape S-303 writes into `checkpoint`: a full `GenerationResult`, flagged partial. */
const checkpointResult = (placements: GeneratedPlacement[]): GenerationResult => ({
  placements,
  diagnostics: {
    engine: "cp-sat",
    elapsedMs: 4200,
    partial: true,
    provenOptimal: false,
    cohorts: {
      dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
      dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
    },
  },
});
