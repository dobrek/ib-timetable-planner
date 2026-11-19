import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepJobEmails } from "@/entities/timetable/api/job-email-sweep";
import { createMailpitTransport, type Database, type MailTransport, type SupabaseClient } from "@/shared/api";
import { JOB_EMAIL_FROM, type AppRole } from "@/shared/config";
import {
  addGenerationJob,
  createAuthUser,
  createPlan,
  createSignedInMachineUser,
  teardown,
  type AddGenerationJobInput,
  type SignedInMachineUser,
} from "@/test/factories";
import { urlsIn } from "./email-links";
import { messagesTo, readMessage, waitForMessageTo } from "./mailpit";
import { readPublishableKey } from "./publishable-key";

/**
 * The job-email sweep end to end (S-310): the real `sweepJobEmails`, under a client signed in as the
 * `job_notifier` machine role with the publishable key, sending through the local stack's Mailpit.
 *
 * - **Real role, real RLS.** The sweep reads due jobs, recipients and plan names through the
 *   notifier's own column grants and policies, exactly as the Worker's cron does.
 * - **The structural contract** every product email keeps: one link, no form, script or image, no
 *   `error` text (a sentinel is planted there), exactly one message per job.
 * - **The sweep is global**, and the lane runs suites in parallel. So every test uses addresses of
 *   its own and asserts per address and per row, never on a mailbox or a count of all jobs. Other
 *   suites' opted-in jobs are running and fresh, so the sweep waits on them and never mails them.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const ORIGIN = "http://localhost:4321";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

const MINUTE = 60_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

const diagnostics = {
  engine: "cp-sat",
  elapsedMs: 1,
  partial: false,
  cohorts: {
    dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [{ courseId: "c1", missing: 2 }] },
    dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
  },
};

type Settled = { emailed_at: string | null; email_outcome: string | null; email_claimed_at: string | null };

(hasEnv ? describe : describe.skip)("job email sweep (local Supabase + Mailpit)", () => {
  let admin: SupabaseClient;
  let notifier: SignedInMachineUser;
  let transport: MailTransport;

  const sweep = () => sweepJobEmails(notifier.client, transport, { origin: ORIGIN, nowMs: Date.now() });

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    notifier = await createSignedInMachineUser(admin, "job_notifier");
    transport = createMailpitTransport({ url: MAILPIT_URL, from: JOB_EMAIL_FROM });
  }, 30_000);

  afterAll(async () => {
    if (hasEnv) await teardown(admin);
  });

  /**
   * A person who may request a job: a confirmed Auth user with a unique address, holding `role` (none
   * when null), and optionally pending or deactivated, the fences the role matrix's `pendingAdmin`
   * and `deactivatedAdmin` principals hold. No sign-in: the sweep only reads their rows.
   */
  const person = async ({
    role = "author",
    mustChangePassword = false,
    deactivated = false,
  }: { role?: AppRole | null; mustChangePassword?: boolean; deactivated?: boolean } = {}) => {
    const user = await createAuthUser(admin);
    if (role !== null) {
      setUp(
        await admin
          .from("user_roles")
          .insert({ user_id: user.id, role, deactivated_at: deactivated ? new Date().toISOString() : null }),
      );
    }
    if (mustChangePassword) {
      setUp(await admin.from("user_directory").update({ must_change_password: true }).eq("user_id", user.id));
    }
    return user;
  };

  /** An opted-in job on a plan of its own, finished two minutes ago unless told otherwise. */
  const optedInJob = async (input: Omit<AddGenerationJobInput, "planId"> = {}) => {
    const [planId, proposalPlanId] = await Promise.all([
      createPlan(admin, { name: `Email ${randomUUID()}` }),
      createPlan(admin),
    ]);
    const jobId = await addGenerationJob(admin, {
      planId,
      proposalPlanId,
      status: "succeeded",
      emailRequested: true,
      startedAt: ago(25 * MINUTE),
      finishedAt: ago(2 * MINUTE),
      heartbeatAt: ago(2 * MINUTE),
      policy: { preset: "student-first" },
      result: { diagnostics, placements: [] },
      ...input,
    });
    return { jobId, planId, proposalPlanId };
  };

  const settledOf = async (jobId: string): Promise<Settled> => {
    const { data, error } = await admin
      .from("generation_jobs")
      .select("emailed_at, email_outcome, email_claimed_at")
      .eq("id", jobId)
      .single();
    if (error) throw new Error(`read-back: ${error.message}`);
    return data;
  };

  it("emails a finished job's requester once, under the structural contract, and stamps it sent", async () => {
    const requester = await person();
    const sentinel = `SENTINEL-${randomUUID()}`;
    const { jobId, proposalPlanId } = await optedInJob({ requestedBy: requester.id, error: sentinel });

    await sweep();

    const message = await waitForMessageTo(requester.email);
    const { HTML, Text, Subject } = await readMessage(message.ID);
    expect(Subject).toMatch(/^IB Planner: generation finished for “Email /);
    expect(urlsIn(HTML)).toEqual([`${ORIGIN}/plans/${proposalPlanId}`]);
    expect(urlsIn(Text)).toEqual([`${ORIGIN}/plans/${proposalPlanId}`]);
    expect(HTML).not.toMatch(/<form|<script|<img/i);
    expect(`${HTML}${Text}`).not.toContain(sentinel);
    expect(Text).toContain("1 course could not be fully placed (2 hours left to place).");
    expect(Text).toContain("Policy: student-first");
    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "sent" });

    // A second sweep finds nothing due: still exactly the one message.
    await sweep();
    expect((await messagesTo(requester.email)).map(({ ID }) => ID)).toEqual([message.ID]);
  });

  it("never touches a job that did not ask for an email", async () => {
    const requester = await person();
    const { jobId } = await optedInJob({ requestedBy: requester.id, emailRequested: false });

    await sweep();

    expect(await settledOf(jobId)).toEqual({ emailed_at: null, email_outcome: null, email_claimed_at: null });
    expect(await messagesTo(requester.email)).toEqual([]);
  });

  it("fences a pending, a deactivated and a role-less requester, recording why", async () => {
    const fenced = await Promise.all([
      person({ role: "admin", mustChangePassword: true }),
      person({ role: "admin", deactivated: true }),
      person({ role: null }),
    ]);
    const jobs = await Promise.all(fenced.map((user) => optedInJob({ requestedBy: user.id })));

    await sweep();

    for (const [i, { jobId }] of jobs.entries()) {
      expect(await settledOf(jobId), `requester ${String(i)}`).toMatchObject({ email_outcome: "recipient_fenced" });
    }
    for (const user of fenced) expect(await messagesTo(user.email)).toEqual([]);
  });

  it("records no_recipient for a job that names nobody", async () => {
    const { jobId } = await optedInJob({ requestedBy: null });

    await sweep();

    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "no_recipient" });
  });

  it("skips a job its requester stopped, and emails one an admin stopped", async () => {
    const [selfStopper, stoppedByAdmin, schoolAdmin] = await Promise.all([
      person(),
      person(),
      person({ role: "admin" }),
    ]);
    const stopped = { status: "stopped" as const, result: null };
    const [self, byAdmin] = await Promise.all([
      optedInJob({ ...stopped, requestedBy: selfStopper.id, stopRequestedBy: selfStopper.id }),
      optedInJob({ ...stopped, requestedBy: stoppedByAdmin.id, stopRequestedBy: schoolAdmin.id }),
    ]);

    await sweep();

    expect(await settledOf(self.jobId)).toMatchObject({ email_outcome: "stopped_by_requester" });
    expect(await messagesTo(selfStopper.email)).toEqual([]);
    const message = await waitForMessageTo(stoppedByAdmin.email);
    expect(message.Subject).toMatch(/^IB Planner: generation stopped for /);
    expect(urlsIn((await readMessage(message.ID)).HTML)).toEqual([`${ORIGIN}/plans/${byAdmin.planId}`]);
    expect(await settledOf(byAdmin.jobId)).toMatchObject({ email_outcome: "sent" });
  });

  it("sends one stalled email for a job that went quiet, and nothing more once it is reclaimed", async () => {
    const requester = await person();
    const { jobId, planId } = await optedInJob({
      status: "running",
      requestedBy: requester.id,
      finishedAt: null,
      heartbeatAt: ago(10 * MINUTE),
      result: null,
    });

    await sweep();

    const message = await waitForMessageTo(requester.email);
    expect(message.Subject).toMatch(/^IB Planner: generation stopped responding for /);
    expect(urlsIn((await readMessage(message.ID)).HTML)).toEqual([`${ORIGIN}/plans/${planId}`]);
    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "sent_stalled" });

    // An editor's visit reclaims the row later. The email was this job's one: nothing more is sent.
    setUp(
      await admin
        .from("generation_jobs")
        .update({ status: "interrupted", finished_at: new Date().toISOString() })
        .eq("id", jobId),
    );
    await sweep();
    expect((await messagesTo(requester.email)).map(({ ID }) => ID)).toEqual([message.ID]);
  });

  it("expires an event older than a day without emailing", async () => {
    const requester = await person();
    const { jobId } = await optedInJob({ requestedBy: requester.id, finishedAt: ago(25 * 60 * MINUTE) });

    await sweep();

    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "expired" });
    expect(await messagesTo(requester.email)).toEqual([]);
  });

  it("emails a requester demoted to viewer: being able to read the plan is enough", async () => {
    const viewer = await person({ role: "viewer" });
    const { jobId } = await optedInJob({ requestedBy: viewer.id });

    await sweep();

    await waitForMessageTo(viewer.email);
    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "sent" });
  });

  it("sends exactly one message when two sweeps run over the same job at once", async () => {
    const requester = await person();
    const { jobId } = await optedInJob({ requestedBy: requester.id });

    await Promise.all([sweep(), sweep()]);

    const message = await waitForMessageTo(requester.email);
    expect(await settledOf(jobId)).toMatchObject({ email_outcome: "sent" });
    // Give a second send, had there been one, time to land before counting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await messagesTo(requester.email)).map(({ ID }) => ID)).toEqual([message.ID]);
  });
});

/** A setup write. It throws on any error: a failed setup must never read as a result. */
const setUp = ({ error }: { error: { message: string } | null }): void => {
  if (error) throw new Error(`setup failed: ${error.message}`);
};
