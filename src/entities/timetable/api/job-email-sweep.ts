import {
  unwrapMany,
  type MailTransport,
  type SendFailure,
  type SendStopReason,
  type SupabaseClient,
} from "@/shared/api";
import {
  decideJobPhase,
  decideRecipient,
  sentOutcome,
  type JobEmailDecision,
  type JobEmailJobFacts,
  type JobEmailKind,
  type JobEmailOutcome,
  type JobEmailPhase,
  type JobEmailRecipientFacts,
} from "../model/generation/job-email";
import { buildJobEmail } from "../model/generation/job-email-content";
import { isGenerationJobStatus } from "../model/generation/job-status";

/**
 * One run of the job-email sweep (S-310): read the jobs whose email is still due, decide each, claim,
 * send, and stamp. The Worker's cron calls it once a minute, signed in as `job_notifier`; the
 * integration suite calls it directly, with the same role and Mailpit.
 *
 * **Everything is injected** (the client, the transport, the origin and the clock), so the shipped
 * path and the tested path are the same path. Like `solver-config.ts`, this module is imported at its
 * own path and stays out of the entity barrel, which React islands pull into the client bundle.
 *
 * **The job row is the only status channel.** A due job is `email_requested and emailed_at is null`.
 * A send that fails is simply a row that is still due, so the next run retries it: nothing is pushed,
 * and nothing is lost.
 *
 * **Claim before sending, stamp after.** The claim is a compare-and-set on `email_claimed_at` (null,
 * or older than `CLAIM_TTL_MS`) while `emailed_at` is null. It is what keeps two overlapping runs, and
 * two parallel test sweeps over Mailpit (which has no idempotency), from sending twice. On a failed
 * send the claim is left to expire: that is the backoff. Resend's `Idempotency-Key` covers the one gap
 * the claim cannot, a send that succeeded but whose stamp never landed.
 *
 * **Skips honour a live claim too.** A skip stamps only an unclaimed (or expired) row, so a run that
 * decides to skip can never overwrite the record of a send another run is making.
 *
 * It reads `diagnostics` only, through JSON paths on `result` and `checkpoint`, never the payloads,
 * and never `error` or `snapshot`, which the role cannot read anyway. The report holds counts, why
 * the run stopped sending, and each failed send's status and error name: no address and no plan name
 * ever leaves this function.
 */
export type JobEmailSweepReport = {
  /** Emails sent, or found already sent, and stamped. */
  sent: number;
  /** Jobs settled without an email: expired, stopped by their requester, refused at dispatch, no recipient, or fenced. */
  skipped: number;
  /** Jobs still running, or held by another run's claim. */
  waiting: number;
  /** Jobs not reached, because the provider refused every send for now (quota, rate, key). */
  deferred: number;
  /** Why the run stopped sending, or null when it did not. */
  stoppedBy: SendStopReason | null;
  /** Sends that failed; each stays due, and is retried once its claim expires. */
  failed: number;
  /** Each failed send's provider status and error name, in order (`0 no-answer` when nothing came back). */
  failures: SendFailure[];
};

export type JobEmailSweepOptions = {
  /** `APP_ORIGIN`: scheme, host and port, no trailing slash. */
  origin: string;
  /**
   * The run's clock: the cron's `scheduledTime`. Every decision in the run, and the `emailed_at` it
   * settles with, uses it. Claims use the live clock instead (`CLAIM_TTL_MS`).
   */
  nowMs: number;
};

/** At most this many due jobs per run. A handful is the expected load; the rest wait a minute. */
export const SWEEP_BATCH = 50;

/**
 * How long a claim holds before another run may take the job over. A claim is dated and judged by
 * the live clock, never the run's `nowMs`: a run settles its jobs one at a time and can outlast this,
 * so a claim must date from when it was taken (in Workers, `Date.now()` advances across I/O). It only
 * has to outlast one job's claim → send → stamp: a 10 s send and two 20 s database writes at most.
 */
export const CLAIM_TTL_MS = 5 * 60_000;

export async function sweepJobEmails(
  supabase: SupabaseClient,
  transport: MailTransport,
  { origin, nowMs }: JobEmailSweepOptions,
): Promise<JobEmailSweepReport> {
  const rows = await readDueJobs(supabase);
  const phased = rows.map((row) => ({ row, phase: phaseOf(row, nowMs) }));
  const lookups = await readLookups(
    supabase,
    phased.filter(({ phase }) => phase.kind === "needs-recipient").map(({ row }) => row),
  );
  const run = { supabase, transport, origin, nowMs, lookups };
  const outcomes = await settleInOrder(phased, ({ row, phase }) => settle(run, row, decide(phase, row, lookups)));
  return report(outcomes);
}

/** What one job's turn came to. A `stoppedBy` ends the run: every later job is deferred. */
type RowOutcome = "sent" | "skipped" | "waiting" | "deferred" | "failed";

type Settled = { outcome: RowOutcome; stoppedBy?: SendStopReason; failure?: SendFailure };

type DueJob = {
  id: string;
  plan_id: string;
  proposal_plan_id: string | null;
  status: string;
  requested_by: string | null;
  stop_requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  policy: unknown;
  checkpoint_stage_index: number | null;
  resultDiagnostics: unknown;
  checkpointDiagnostics: unknown;
};

type Recipient = { email: string | null; facts: JobEmailRecipientFacts };

type Lookups = { recipients: Map<string, Recipient>; planNames: Map<string, string> };

type Run = {
  supabase: SupabaseClient;
  transport: MailTransport;
  origin: string;
  nowMs: number;
  lookups: Lookups;
};

const DUE_COLUMNS =
  "id, plan_id, proposal_plan_id, status, requested_by, stop_requested_by, created_at, started_at, " +
  "finished_at, heartbeat_at, policy, checkpoint_stage_index, " +
  "resultDiagnostics:result->diagnostics, checkpointDiagnostics:checkpoint->diagnostics";

/** The due set, oldest first, over the partial index `generation_jobs_email_due_idx`. */
const readDueJobs = async (supabase: SupabaseClient): Promise<DueJob[]> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(DUE_COLUMNS)
    .eq("email_requested", true)
    .is("emailed_at", null)
    .order("created_at")
    .limit(SWEEP_BATCH)
    .overrideTypes<DueJob[], { merge: false }>();
  if (error) throw new Error(`job email: could not read due jobs: ${error.message}`);
  return data;
};

/** An unrecognised status is never guessed at: the row waits, untouched. */
const phaseOf = (row: DueJob, nowMs: number): JobEmailPhase =>
  hasKnownStatus(row) ? decideJobPhase(row, nowMs) : { kind: "wait" };

/** The row's other columns already are the decision's facts, as selected. */
const hasKnownStatus = (row: DueJob): row is DueJob & JobEmailJobFacts => isGenerationJobStatus(row.status);

/**
 * The requesters' directory and role rows, and the source plans' names, in three batch reads, only
 * for the jobs that need them. The role's policies show these rows only while a job referring to
 * them still has an email due, which is exactly the set asked for here.
 */
const readLookups = async (supabase: SupabaseClient, rows: DueJob[]): Promise<Lookups> => {
  if (rows.length === 0) return { recipients: new Map(), planNames: new Map() };
  const userIds = [...new Set(rows.flatMap(({ requested_by }) => (requested_by === null ? [] : [requested_by])))];
  const planIds = [...new Set(rows.map(({ plan_id }) => plan_id))];

  const failure = "job email: could not read recipients or plans";
  const [directory, roles, plans] = await Promise.all([
    supabase
      .from("user_directory")
      .select("user_id, email, must_change_password")
      .in("user_id", userIds)
      .then((result) => unwrapMany(result, failure)),
    supabase
      .from("user_roles")
      .select("user_id, deactivated_at")
      .in("user_id", userIds)
      .then((result) => unwrapMany(result, failure)),
    supabase
      .from("plans")
      .select("id, name")
      .in("id", planIds)
      .then((result) => unwrapMany(result, failure)),
  ]);

  const roleOf = new Map(roles.map((role) => [role.user_id, { deactivatedAt: role.deactivated_at }]));
  return {
    recipients: new Map(
      directory.map((entry) => [
        entry.user_id,
        {
          email: entry.email,
          facts: { mustChangePassword: entry.must_change_password, role: roleOf.get(entry.user_id) ?? null },
        },
      ]),
    ),
    planNames: new Map(plans.map((plan) => [plan.id, plan.name])),
  };
};

/** A job with no requester, no directory row, or no address on it has nobody to email. */
const decide = (phase: JobEmailPhase, row: DueJob, lookups: Lookups): JobEmailDecision => {
  if (phase.kind !== "needs-recipient") return phase;
  const recipient = row.requested_by === null ? undefined : lookups.recipients.get(row.requested_by);
  return decideRecipient(phase, recipient?.email ? recipient.facts : null);
};

const settle = async (run: Run, row: DueJob, decision: JobEmailDecision): Promise<Settled> => {
  if (decision.kind === "wait") return { outcome: "waiting" };
  if (decision.kind === "skip") {
    return { outcome: (await stamp(run, row.id, decision.outcome)) ? "skipped" : "waiting" };
  }
  return send(run, row, decision.email);
};

const send = async (run: Run, row: DueJob, kind: JobEmailKind): Promise<Settled> => {
  const to = row.requested_by === null ? null : (run.lookups.recipients.get(row.requested_by)?.email ?? null);
  if (to === null || !(await claim(run, row.id))) return { outcome: "waiting" };

  const email = buildJobEmail(kind, contentFacts(row, run.lookups), run.origin);
  const outcome = await run.transport.send({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `job-email/${row.id}`,
  });

  if (outcome.kind === "sent" || outcome.kind === "already-sent") {
    await stamp(run, row.id, sentOutcome(kind), { claimed: true });
    return { outcome: "sent" };
  }
  if (outcome.kind === "in-flight") return { outcome: "waiting" };
  if (outcome.kind === "stop-tick") return { outcome: "deferred", stoppedBy: outcome.reason };
  return { outcome: "failed", failure: { status: outcome.status, name: outcome.name } };
};

const contentFacts = (row: DueJob, lookups: Lookups) => ({
  planName: lookups.planNames.get(row.plan_id) ?? "",
  planId: row.plan_id,
  proposalPlanId: row.proposal_plan_id,
  policy: row.policy,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  heartbeatAt: row.heartbeat_at,
  checkpointStageIndex: row.checkpoint_stage_index,
  resultDiagnostics: row.resultDiagnostics,
  checkpointDiagnostics: row.checkpointDiagnostics,
});

/** Take the job for this run: true iff no other run holds a live claim and its email is unsettled. */
const claim = async ({ supabase }: Run, jobId: string): Promise<boolean> => {
  const claimedAtMs = Date.now();
  const { data, error } = await supabase
    .from("generation_jobs")
    .update({ email_claimed_at: new Date(claimedAtMs).toISOString() })
    .eq("id", jobId)
    .is("emailed_at", null)
    .or(unclaimedAt(claimedAtMs))
    .select("id");
  if (error) throw new Error(`job email: could not claim job ${jobId}: ${error.message}`);
  return data.length === 1;
};

/**
 * Settle the job's email, once: a compare-and-set on `emailed_at is null`. A run settling its own
 * send holds the claim; a skip may settle only a job nobody holds a live claim on. True iff this
 * write settled it.
 */
const stamp = async (
  { supabase, nowMs }: Run,
  jobId: string,
  outcome: JobEmailOutcome,
  { claimed = false }: { claimed?: boolean } = {},
): Promise<boolean> => {
  const settling = supabase
    .from("generation_jobs")
    .update({ emailed_at: new Date(nowMs).toISOString(), email_outcome: outcome })
    .eq("id", jobId)
    .is("emailed_at", null);
  const unclaimed = claimed ? settling : settling.or(unclaimedAt(Date.now()));
  const { data, error } = await unclaimed.select("id");
  if (error) throw new Error(`job email: could not settle job ${jobId}: ${error.message}`);
  return data.length === 1;
};

/**
 * No live claim at `atMs`: never claimed, or claimed more than `CLAIM_TTL_MS` before it. The cutoff is
 * double-quoted inside the `or` filter, so its `:` and `.` stay part of the value.
 */
const unclaimedAt = (atMs: number): string =>
  `email_claimed_at.is.null,email_claimed_at.lt."${new Date(atMs - CLAIM_TTL_MS).toISOString()}"`;

/**
 * Settle each job in turn, oldest first, one send at a time (Resend allows 10 requests a second).
 * Once the provider refuses every send for now, the jobs after it are not tried: they are deferred.
 */
const settleInOrder = async <T>(items: T[], handle: (item: T) => Promise<Settled>): Promise<Settled[]> => {
  const [first, ...rest] = items;
  if (first === undefined) return [];
  const settled = await handle(first);
  return settled.stoppedBy === undefined
    ? [settled, ...(await settleInOrder(rest, handle))]
    : [settled, ...rest.map((): Settled => ({ outcome: "deferred" }))];
};

const report = (settled: Settled[]): JobEmailSweepReport => {
  const count = (outcome: RowOutcome): number => settled.filter((row) => row.outcome === outcome).length;
  return {
    sent: count("sent"),
    skipped: count("skipped"),
    waiting: count("waiting"),
    deferred: count("deferred"),
    stoppedBy: settled.find((row) => row.stoppedBy !== undefined)?.stoppedBy ?? null,
    failed: count("failed"),
    failures: settled.flatMap((row) => (row.failure === undefined ? [] : [row.failure])),
  };
};
