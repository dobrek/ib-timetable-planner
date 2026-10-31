import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  HEARTBEAT_GRACE_MS,
  type GeneratedPlacement,
  type GenerationResult,
  type SolverTransport,
} from "@/entities/timetable";
import {
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan,
  createSignedInUser,
  registerPlan,
  teardown,
  type SignedInUser,
} from "@/test/factories";
import { readPublishableKey } from "@/test/publishable-key";
import { checkPlan } from "./generation-delivery";
import { startGeneration } from "./generation-job";
import { readPlanJob } from "./generation-read";

/**
 * A viewer's visit never writes (S-405), proven under a real viewer session.
 *
 * Every read here runs through a publishable-key client signed in as a `viewer`, so RLS is in play:
 * the claim is not that `readPlanJob` happens to issue no writes, but that what a viewer's session
 * reads leaves the job row, the proposal's pending flag and its board exactly as they were. Each case
 * reads the rows back as the service role, before and after, and compares them whole — so even a
 * write that changed nothing but `updated_at` would show.
 *
 * The other half of the decision ("wait for an author", Open Question 1) is that nothing is lost by
 * waiting: the next AUTHOR visit, through the delivering `checkPlan`, still lands the board, and the
 * viewer's next read then reports it delivered.
 *
 * Jobs are built the way `generation-delivery.integration.test.ts` builds them: the real enqueue path
 * (a real snapshot and a real `clone_plan` clone), then the row the solver would have written.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && readPublishableKey());

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

/** Comfortably past the grace, so no clock skew between the test and the database can matter. */
const LONG_DEAD = (): string => new Date(Date.now() - HEARTBEAT_GRACE_MS * 2).toISOString();

(hasEnv ? describe : describe.skip)("readPlanJob as a viewer (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let viewer: SignedInUser;
  let author: SignedInUser;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    [viewer, author] = await Promise.all([
      createSignedInUser(admin, { role: "viewer" }),
      createSignedInUser(admin, { role: "author" }),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (hasEnv) await teardown(admin);
  });

  /** A minimal two-cohort plan: each cohort gets one 1-hour course with a teacher and a student. */
  const tinyPlan = async (label: string): Promise<{ planId: string; dp1CourseId: string }> => {
    const planId = await createPlan(admin, { name: `Viewer read ${label} ${crypto.randomUUID()}` });
    const courseIds: Record<"dp1" | "dp2", string> = { dp1: "", dp2: "" };
    for (const cohort of ["dp1", "dp2"] as const) {
      const { teacherId } = await addTeacher(admin, { planId, code: `T-${cohort}-${label}` });
      const { courseId } = await addCourse(admin, {
        planId,
        cohort,
        name: `Course ${cohort}`,
        hoursPerWeek: 1,
        teacherIds: [teacherId],
      });
      await addStudentWithChoices(admin, { planId, cohort, fullName: `S ${cohort}`, courseIds: [courseId] });
      courseIds[cohort] = courseId;
    }
    return { planId, dp1CourseId: courseIds.dp1 };
  };

  /** Enqueue for real, as the service role. The clone is registered so teardown removes it. */
  const enqueued = async (planId: string): Promise<{ jobId: string; proposalPlanId: string }> => {
    const { jobId, proposalPlanId } = await startGeneration(
      admin,
      { planId },
      { getTransport: () => acceptingTransport },
    );
    registerPlan(proposalPlanId);
    return { jobId, proposalPlanId };
  };

  /** Enqueue, then write the terminal row the solver would have written. */
  const solvedJob = async (planId: string, placements: GeneratedPlacement[]) => {
    const job = await enqueued(planId);
    const result: GenerationResult = {
      placements,
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 1234,
        partial: false,
        provenOptimal: true,
        cohorts: {
          dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
        },
      },
    };
    setUp(
      await admin
        .from("generation_jobs")
        .update({
          status: "succeeded",
          result,
          stages: [{ tier: 5, name: "softHits", status: "OPTIMAL", best: 0, bound: 0, wallClockS: 1 }],
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.jobId),
    );
    return job;
  };

  /** Everything a viewer's read could have written, read back whole by the service role. */
  const footprint = async (jobId: string, proposalPlanId: string) => ({
    job: readBack(await admin.from("generation_jobs").select("*").eq("id", jobId).single()),
    proposal: readBack(await admin.from("plans").select("*").eq("id", proposalPlanId).single()),
    placements: readBack(
      await admin.from("placements").select("*").eq("plan_id", proposalPlanId).order("id", { ascending: true }),
    ),
  });

  const notifiedAt = async (jobId: string): Promise<string | null> =>
    readBack(await admin.from("generation_jobs").select("notified_at").eq("id", jobId).single()).notified_at;

  it("reports a finished board as awaiting delivery, and leaves the row, the flag and the board as they were", async () => {
    const { planId, dp1CourseId } = await tinyPlan("awaiting");
    const { jobId, proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);
    const before = await footprint(jobId, proposalPlanId);

    // Both keys: the pending page reads by the proposal, the source's strip by the source.
    const asProposal = await readPlanJob(viewer.client, { planId: proposalPlanId });
    const asSource = await readPlanJob(viewer.client, { planId });

    expect(asProposal).toMatchObject({
      jobId,
      role: "proposal",
      status: "succeeded",
      delivered: false,
      awaitingDelivery: true,
      stalled: false,
    });
    expect(asSource).toMatchObject({ jobId, role: "source", delivered: false, awaitingDelivery: true });
    expect(await footprint(jobId, proposalPlanId)).toEqual(before);
    expect(before.proposal.pending_proposal).toBe(true);
    expect(before.placements).toEqual([]);
  });

  it("waits for an author: their visit delivers, the viewer then reads it delivered, and only the author stamped notified_at", async () => {
    const { planId, dp1CourseId } = await tinyPlan("author-delivers");
    const { jobId, proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 2, period: 3, week: "both" },
    ]);

    await readPlanJob(viewer.client, { planId: proposalPlanId });
    expect(await notifiedAt(jobId)).toBeNull();

    // The author opens the proposal: the delivering visit, under the author's own session.
    const delivered = await checkPlan(author.client, { planId: proposalPlanId });
    expect(delivered).toMatchObject({ jobId, role: "proposal", delivered: true, awaitingDelivery: false });
    const stamped = await notifiedAt(jobId);
    expect(stamped).not.toBeNull();

    const afterDelivery = await footprint(jobId, proposalPlanId);
    expect(afterDelivery.proposal.pending_proposal).toBe(false);
    expect(afterDelivery.placements).toHaveLength(1);

    // The viewer's next read: the tick that turns their pending page into the board.
    const seen = await readPlanJob(viewer.client, { planId: proposalPlanId });
    expect(seen).toMatchObject({ jobId, delivered: true, awaitingDelivery: false, stalled: false });
    expect(await notifiedAt(jobId)).toBe(stamped);
    expect(await footprint(jobId, proposalPlanId)).toEqual(afterDelivery);
  });

  it("reports a job that went quiet as stalled, and leaves it running", async () => {
    const { planId } = await tinyPlan("stalled");
    const { jobId, proposalPlanId } = await enqueued(planId);
    // A container killed mid-solve: `running`, with a heartbeat that stopped renewing.
    setUp(
      await admin
        .from("generation_jobs")
        .update({ status: "running", started_at: LONG_DEAD(), heartbeat_at: LONG_DEAD() })
        .eq("id", jobId),
    );
    const before = await footprint(jobId, proposalPlanId);

    const view = await readPlanJob(viewer.client, { planId: proposalPlanId });

    expect(view).toMatchObject({ jobId, status: "running", stalled: true, awaitingDelivery: false, delivered: false });
    expect(await footprint(jobId, proposalPlanId)).toEqual(before);
    expect(before.job).toMatchObject({ status: "running", finished_at: null, error: null });
  });

  it("leaves notified_at null on a delivered proposal it reads", async () => {
    const { planId, dp1CourseId } = await tinyPlan("unannounced");
    const { jobId, proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 4, period: 2, week: "both" },
    ]);
    // Delivered through the SOURCE, which never stamps: the board is there and nobody has been told.
    expect((await checkPlan(admin, { planId }))?.delivered).toBe(true);
    expect(await notifiedAt(jobId)).toBeNull();
    const before = await footprint(jobId, proposalPlanId);

    const view = await readPlanJob(viewer.client, { planId: proposalPlanId });

    // A viewer's look is not the announcement: the authors' "Ready" badge stays up.
    expect(view).toMatchObject({ jobId, role: "proposal", delivered: true });
    expect(await notifiedAt(jobId)).toBeNull();
    expect(await footprint(jobId, proposalPlanId)).toEqual(before);
  });
});

/** A service-role setup write. It throws on any error: a failed setup must never pass as a result. */
const setUp = ({ error }: { error: { message: string } | null }): void => {
  if (error) throw new Error(`setup failed: ${error.message}`);
};

/** A service-role read-back. It throws on any error: a failed read-back must never read as "unchanged". */
const readBack = <T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (error || data === null || data === undefined) throw new Error(`read-back failed: ${error?.message ?? "no data"}`);
  return data;
};
