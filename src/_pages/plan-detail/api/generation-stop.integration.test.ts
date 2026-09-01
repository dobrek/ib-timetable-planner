import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import type { SolverTransport } from "@/entities/timetable";
import {
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan as createFactoryPlan,
  registerPlan,
  teardown,
} from "@/test/factories";
import { checkPlan } from "./generation-delivery";
import { startGeneration } from "./generation-job";
import { stopGeneration } from "./generation-stop";

/**
 * Stop & keep's WRITE half against the real local stack (S-305).
 *
 * The job row is created by the REAL enqueue path — so its clone is a real `clone_plan` clone and
 * its `snapshot` a real assembled one — and the solver is then simulated by writing whichever status
 * a scenario needs. That is honest here for the same reason it is in the delivery suite: everything
 * this function does happens on the ROW, and the solver's own half (observing the flag) is pinned
 * wrapper-level in `services/solver/tests/test_service.py`, where it needs no database at all.
 *
 * The four outcomes, and the sweep that follows one of them, are what this suite exists to pin —
 * plus the ordering rule the plan calls out: the queued CAS is tried FIRST, so a row that has since
 * been claimed falls through to the flag write rather than getting a flag nothing will ever poll.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

(hasEnv ? describe : describe.skip)("stopGeneration (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  /** The same minimal two-cohort plan the delivery suite uses: one 1-hour course per cohort. */
  const tinyPlan = async (label: string): Promise<string> => {
    const planId = await createFactoryPlan(supabase, { name: `Stop ${label} ${crypto.randomUUID()}` });
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
    }
    return planId;
  };

  /** Enqueue for real. The row lands `queued` — which is where a stop can still terminalise it. */
  const queuedJob = async (label: string): Promise<{ planId: string; jobId: string; proposalPlanId: string }> => {
    const planId = await tinyPlan(label);
    const { jobId, proposalPlanId } = await startGeneration(
      supabase,
      { planId },
      { getTransport: () => acceptingTransport },
    );
    registerPlan(proposalPlanId);
    return { planId, jobId, proposalPlanId };
  };

  const jobRow = async (jobId: string) =>
    (
      await supabase
        .from("generation_jobs")
        .select("status, error, finished_at, stop_requested_at, checkpoint_stage_index, proposal_plan_id")
        .eq("id", jobId)
        .single()
    ).data;

  type JobUpdate = Database["public"]["Tables"]["generation_jobs"]["Update"];

  const setStatus = async (jobId: string, patch: JobUpdate): Promise<void> => {
    const { error } = await supabase.from("generation_jobs").update(patch).eq("id", jobId);
    if (error) throw new Error(`setStatus: ${error.message}`);
  };

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  it("terminalises a QUEUED job app-side — there is no solver to ask and nothing to keep", async () => {
    const { jobId } = await queuedJob("queued");

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "stopped" });

    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "stopped", checkpoint_stage_index: null });
    expect(row?.finished_at).not.toBeNull();
    // The flag rides along even though nothing will poll it: it is the durable record that a HUMAN
    // asked, which is what distinguishes this row from one S-304's reclaim swept.
    expect(row?.stop_requested_at).not.toBeNull();
    expect(row?.error).toMatch(/stopped by the author/);
  });

  it("sweeps the clone of a stopped-before-start job on the next visit", async () => {
    // The stopped-no-checkpoint branch: `isSweepableJob` admits it, so `checkPlan`'s existing settle
    // path deletes the clone — the same path a failed job already takes. `stopGeneration` itself
    // never touches `plans`, so this is the assertion that one sweeper is enough.
    const { planId, jobId, proposalPlanId } = await queuedJob("queued-sweep");
    await stopGeneration(supabase, { jobId });

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "stopped", delivered: false, proposalPlanId: null });
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("requests a stop on a RUNNING job without touching its status", async () => {
    const { jobId } = await queuedJob("running");
    await setStatus(jobId, { status: "running", started_at: new Date().toISOString() });

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "stopping" });

    const row = await jobRow(jobId);
    // Still running, and that is the whole point: the solver owns the terminal write, so a stop is a
    // request until its heartbeat has seen the flag and the ladder has unwound.
    expect(row?.status).toBe("running");
    expect(row?.stop_requested_at).not.toBeNull();
    expect(row?.finished_at).toBeNull();
    expect(row?.error).toBeNull();
  });

  it("falls through to the flag write when the queued CAS loses to a claim", async () => {
    // The ordering rule, asserted where it bites: the CAS is tried first and matches nothing on a
    // row a solver claimed a millisecond ago, so the flag write is what answers. Done the other way
    // round, a genuinely queued row would get a flag nothing polls and then be terminalised anyway.
    const { jobId } = await queuedJob("claim-race");
    await setStatus(jobId, { status: "running", started_at: new Date().toISOString() });

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "stopping" });

    expect(await jobRow(jobId)).toMatchObject({ status: "running" });
  });

  it("re-stamping an already-requested stop is benign", async () => {
    const { jobId } = await queuedJob("twice");
    await setStatus(jobId, { status: "running", started_at: new Date().toISOString() });
    await stopGeneration(supabase, { jobId });
    const first = (await jobRow(jobId))?.stop_requested_at;

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "stopping" });

    const second = (await jobRow(jobId))?.stop_requested_at;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // The solver's poll asks only whether the column is non-null, and its latch is first-writer-wins,
    // so a second instant changes nothing about the outcome.
    expect(await jobRow(jobId)).toMatchObject({ status: "running" });
  });

  it("answers already-finished when the solve won the race — never an error", async () => {
    const { jobId } = await queuedJob("finished");
    const finishedAt = new Date().toISOString();
    await setStatus(jobId, { status: "succeeded", finished_at: finishedAt });

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "already-finished" });

    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: "succeeded", stop_requested_at: null });
    // Compared as instants, not strings: Postgres renders `timestamptz` with a `+00:00` offset
    // where `toISOString()` writes `Z`.
    expect(new Date(row?.finished_at ?? 0).getTime()).toBe(new Date(finishedAt).getTime());
  });

  it("leaves an already-stopped job exactly as it was", async () => {
    const { jobId } = await queuedJob("already-stopped");
    await stopGeneration(supabase, { jobId });
    const before = await jobRow(jobId);

    await expect(stopGeneration(supabase, { jobId })).resolves.toEqual({ outcome: "already-finished" });

    expect(await jobRow(jobId)).toEqual(before);
  });
});
