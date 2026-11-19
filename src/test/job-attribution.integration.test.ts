import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGeneration, stopGeneration } from "@/_pages/plan-detail/api";
import { clonePlanGuarded } from "@/_pages/plans-list/api/clone-plan-guarded";
import { createPlan as createPlanAs } from "@/_pages/plans-list/api/create-plan";
import type { SolverTransport } from "@/entities/timetable";
import type { Database, SupabaseClient } from "@/shared/api";
import {
  addCourse,
  addGenerationJob,
  addStudentWithChoices,
  addTeacher,
  createPlan,
  createSignedInUser,
  generationJobRow,
  registerPlan,
  teardown,
  type SignedInUser,
} from "@/test/factories";

/**
 * Who made a plan, who requested a job and who stopped it (S-407), through clients signed in with
 * the publishable key: the behaviour the role matrix cannot state as allowed and denied cells.
 *
 * - **Credit on every path.** A new plan, a duplicate and a Generate are credited by the columns'
 *   `auth.uid()` defaults, through the app's own domain functions, so no write code names the user.
 * - **The guard stamps, and the service role names.** A signed-in insert is stamped with its own
 *   id whatever it sends; the service role keeps the ids it names, which the matrix relies on.
 * - **The first stopper wins.** A re-stamp keeps whoever asked first.
 * - **Deleting a user clears their credit and nothing else.** The FK's set-null cascade runs as the
 *   table owner, so the guard lets it through, and `plans_updated_at` skips it, so "Last updated"
 *   stays put.
 * - **The email choice is the launch's, and its record the notifier's (S-310).** A signed-in insert
 *   keeps `email_requested` and clears the three markers, and no signed-in session changes any of
 *   the four afterwards: `authenticated` holds table-wide UPDATE, so without the guard an editor
 *   could silence or re-arm someone else's email.
 *
 * The solver is faked at the transport seam, as in the enqueue suite: only the job row matters here.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

(hasEnv ? describe : describe.skip)("job and plan attribution (local Supabase)", () => {
  let admin: SupabaseClient;
  let author: SignedInUser;
  let otherEditor: SignedInUser;
  let schoolAdmin: SignedInUser;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    [author, otherEditor, schoolAdmin] = await Promise.all([
      createSignedInUser(admin, { role: "author" }),
      createSignedInUser(admin, { role: "author" }),
      createSignedInUser(admin, { role: "admin" }),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (hasEnv) await teardown(admin);
  });

  /** A plan Generate can solve: one 1-hour course, teacher and student per cohort. */
  const solvablePlan = async (): Promise<string> => {
    const planId = await createPlan(admin);
    for (const cohort of ["dp1", "dp2"] as const) {
      const { teacherId } = await addTeacher(admin, { planId, code: `T-${cohort}` });
      const { courseId } = await addCourse(admin, {
        planId,
        cohort,
        name: `Course ${cohort}`,
        hoursPerWeek: 1,
        teacherIds: [teacherId],
      });
      await addStudentWithChoices(admin, { planId, cohort, fullName: `S ${cohort}`, courseIds: [courseId] });
    }
    return planId;
  };

  const creatorOf = async (planId: string): Promise<string | null> =>
    readBack(await admin.from("plans").select("created_by").eq("id", planId).single()).created_by;

  const attributionOf = async (jobId: string) =>
    readBack(
      await admin
        .from("generation_jobs")
        .select("status, requested_by, stop_requested_at, stop_requested_by")
        .eq("id", jobId)
        .single(),
    );

  describe("credit on every path", () => {
    it("credits a new plan to whoever created it", async () => {
      const plan = await createPlanAs(author.client, { name: `Attribution ${randomUUID()}`, slotGridPreset: "5x10" });
      registerPlan(plan.id);

      expect(await creatorOf(plan.id)).toBe(author.id);
    });

    it("credits a duplicate to whoever duplicated it, not to the source's creator", async () => {
      const sourcePlanId = await createPlan(admin);
      setUp(await admin.from("plans").update({ created_by: schoolAdmin.id }).eq("id", sourcePlanId));

      const { id } = await clonePlanGuarded(author.client, {
        sourcePlanId,
        name: `Attribution copy ${randomUUID()}`,
        includeBoard: false,
      });
      registerPlan(id);

      expect(await creatorOf(id)).toBe(author.id);
    });

    it("credits a proposal and its job to whoever pressed Generate", async () => {
      const { jobId, proposalPlanId } = await startGeneration(
        author.client,
        { planId: await solvablePlan() },
        { getTransport: () => acceptingTransport },
      );
      registerPlan(proposalPlanId);

      expect(await creatorOf(proposalPlanId)).toBe(author.id);
      expect(await attributionOf(jobId)).toMatchObject({ requested_by: author.id, stop_requested_by: null });
    });
  });

  describe("the guard stamps a signed-in session, and the service role names", () => {
    it("overwrites a forged requester and a forged stopper on a signed-in insert", async () => {
      const jobId = randomUUID();
      setUp(
        await author.client.from("generation_jobs").insert({
          id: jobId,
          ...(await generationJobRow(await createPlan(admin))),
          status: "failed",
          requested_by: schoolAdmin.id,
          stop_requested_by: schoolAdmin.id,
        }),
      );

      expect(await attributionOf(jobId)).toMatchObject({ requested_by: author.id, stop_requested_by: null });
    });

    it("keeps the ids the service role names, on a plan and on a job", async () => {
      const planId = await createPlan(admin);
      setUp(await admin.from("plans").update({ created_by: author.id }).eq("id", planId));
      const jobId = randomUUID();
      setUp(
        await admin.from("generation_jobs").insert({
          id: jobId,
          ...(await generationJobRow(planId)),
          status: "stopped",
          requested_by: author.id,
          stop_requested_at: new Date().toISOString(),
          stop_requested_by: schoolAdmin.id,
        }),
      );

      expect(await creatorOf(planId)).toBe(author.id);
      expect(await attributionOf(jobId)).toMatchObject({
        requested_by: author.id,
        stop_requested_by: schoolAdmin.id,
      });
    });
  });

  describe("the stopper", () => {
    it("records an admin who stops someone else's job", async () => {
      const jobId = await runningJobOf(admin, author.id);

      await expect(stopGeneration(schoolAdmin.client, { jobId })).resolves.toEqual({ outcome: "stopping" });

      expect(await attributionOf(jobId)).toMatchObject({ requested_by: author.id, stop_requested_by: schoolAdmin.id });
    });

    it("keeps the first stopper when an admin re-stamps a stop the requester made", async () => {
      const jobId = await runningJobOf(admin, author.id);
      await stopGeneration(author.client, { jobId });
      const first = await attributionOf(jobId);

      await expect(stopGeneration(schoolAdmin.client, { jobId })).resolves.toEqual({ outcome: "stopping" });

      const second = await attributionOf(jobId);
      expect(first.stop_requested_by).toBe(author.id);
      expect(second.stop_requested_by).toBe(author.id);
      // The re-stamp did land: compared as instants, since Postgres writes `+00:00` for `Z`.
      expect(new Date(second.stop_requested_at ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(first.stop_requested_at ?? Infinity).getTime(),
      );
    });

    it("refuses withdrawing a stop, to the requester and to an admin alike", async () => {
      const jobId = await runningJobOf(admin, author.id);
      await stopGeneration(schoolAdmin.client, { jobId });
      const stopped = await attributionOf(jobId);

      for (const caller of [author, schoolAdmin]) {
        const { error } = await caller.client
          .from("generation_jobs")
          .update({ stop_requested_at: null })
          .eq("id", jobId);
        expect(error?.code).toBe("42501");
      }

      expect(await attributionOf(jobId)).toEqual(stopped);
    });
  });

  describe("the email choice and its record (S-310)", () => {
    const emailOf = async (jobId: string) =>
      readBack(
        await admin
          .from("generation_jobs")
          .select("email_requested, email_claimed_at, emailed_at, email_outcome")
          .eq("id", jobId)
          .single(),
      );

    it("keeps the choice a signed-in insert makes, and clears the three markers it sends", async () => {
      const jobId = randomUUID();
      const forged = new Date().toISOString();
      setUp(
        await author.client.from("generation_jobs").insert({
          id: jobId,
          ...(await generationJobRow(await createPlan(admin))),
          email_requested: true,
          email_claimed_at: forged,
          emailed_at: forged,
          email_outcome: "sent",
        }),
      );

      expect(await emailOf(jobId)).toEqual({
        email_requested: true,
        email_claimed_at: null,
        emailed_at: null,
        email_outcome: null,
      });
    });

    // Each write is valid against the table's checks, so only the guard can refuse it. The job is
    // `running` with a fresh heartbeat and already settled, so the sweep suite never touches it.
    const rewrites: Record<string, Database["public"]["Tables"]["generation_jobs"]["Update"]> = {
      email_requested: { email_requested: false },
      email_claimed_at: { email_claimed_at: "2026-01-01T00:00:00+00:00" },
      emailed_at: { emailed_at: "2026-01-01T00:00:00+00:00" },
      email_outcome: { email_outcome: "expired" },
    };

    it.each(Object.entries(rewrites))(
      "refuses every signed-in session a change to %s, the requester's included",
      async (_column, rewrite) => {
        const jobId = await settledEmailJobOf(admin, author.id);
        const before = await emailOf(jobId);

        const callers = { requester: author, "other editor": otherEditor, admin: schoolAdmin };
        for (const [who, caller] of Object.entries(callers)) {
          const { error } = await caller.client.from("generation_jobs").update(rewrite).eq("id", jobId);
          expect(error?.code, who).toBe("42501");
        }

        expect(await emailOf(jobId)).toEqual(before);
      },
    );

    it("lets the service role write them: the guard judges signed-in sessions only", async () => {
      const jobId = await settledEmailJobOf(admin, author.id);

      setUp(await admin.from("generation_jobs").update({ email_outcome: "expired" }).eq("id", jobId));

      expect(await emailOf(jobId)).toMatchObject({ email_outcome: "expired" });
    });
  });

  it("deleting a user clears their credit and nothing else, and leaves Last updated alone", async () => {
    const leaver = await createSignedInUser(admin, { role: "author" });
    const plan = await createPlanAs(leaver.client, { name: `Attribution ${randomUUID()}`, slotGridPreset: "5x10" });
    registerPlan(plan.id);
    const jobId = randomUUID();
    setUp(
      await leaver.client
        .from("generation_jobs")
        .insert({ id: jobId, ...(await generationJobRow(await createPlan(admin))) }),
    );
    await expect(stopGeneration(leaver.client, { jobId })).resolves.toEqual({ outcome: "stopped" });
    const before = readBack(await admin.from("plans").select("updated_at").eq("id", plan.id).single());
    expect(await creatorOf(plan.id)).toBe(leaver.id);
    expect(await attributionOf(jobId)).toMatchObject({ requested_by: leaver.id, stop_requested_by: leaver.id });

    const { error } = await admin.auth.admin.deleteUser(leaver.id);

    expect(error).toBeNull();
    expect(readBack(await admin.from("plans").select("created_by, updated_at").eq("id", plan.id).single())).toEqual({
      created_by: null,
      updated_at: before.updated_at,
    });
    expect(await attributionOf(jobId)).toMatchObject({
      status: "stopped",
      requested_by: null,
      stop_requested_by: null,
    });
  });
});

/** A running job on a fresh plan of its own, recording `requestedBy` as its requester. */
const runningJobOf = async (admin: SupabaseClient, requestedBy: string): Promise<string> =>
  addGenerationJob(admin, { planId: await createPlan(admin), status: "running", requestedBy });

/**
 * A `running` job with a fresh heartbeat on a fresh plan, opted in to the job email and already
 * settled by the service role: every email column holds a value a rewrite can visibly change.
 */
const settledEmailJobOf = async (admin: SupabaseClient, requestedBy: string): Promise<string> => {
  const now = new Date().toISOString();
  const jobId = randomUUID();
  setUp(
    await admin.from("generation_jobs").insert({
      id: jobId,
      ...(await generationJobRow(await createPlan(admin))),
      status: "running",
      started_at: now,
      heartbeat_at: now,
      requested_by: requestedBy,
      email_requested: true,
      email_claimed_at: now,
      emailed_at: now,
      email_outcome: "sent",
    }),
  );
  return jobId;
};

/** A setup write. It throws on any error: a failed setup must never read as a result. */
const setUp = ({ error }: { error: { message: string } | null }): void => {
  if (error) throw new Error(`setup failed: ${error.message}`);
};

/** A service-role read-back. It throws on any error: a failed read-back must never read as a result. */
const readBack = <T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (error || data === null || data === undefined) throw new Error(`read-back failed: ${error?.message ?? "no data"}`);
  return data;
};
