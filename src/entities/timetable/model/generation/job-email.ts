import { isActiveJobStatus, type GenerationJobStatus } from "./job-status";
import { isStaleActiveJob } from "./job-staleness";

/**
 * Whether a job that asked for an email gets one, and which (S-310, FR-309): the pure half of the
 * job-email sweep. The sweep reads a job, decides here, and only then reads its recipient, so the
 * decision runs in two stages:
 *
 * 1. `decideJobPhase`, from the job alone: too old to mention, still running, stopped by the
 *    requester themselves, refused at dispatch, or worth an email of a known kind once a recipient
 *    is found.
 * 2. `decideRecipient`, from the requester's account: nobody to email, or someone fenced from the app
 *    (pending, deactivated, or holding no role), or a send.
 *
 * `decideJobEmail` composes them, in the order the plan's decision table states:
 *
 * | Condition                                                          | Result                          |
 * | ------------------------------------------------------------------ | ------------------------------- |
 * | Event older than `JOB_EMAIL_LOOKBACK_MS`                           | skip `expired`                  |
 * | Active and not stale                                               | wait                            |
 * | Stopped by its own requester                                       | skip `stopped_by_requester`     |
 * | `failed` before it started (its dispatch was refused)              | skip `dispatch_refused`         |
 * | No requester, or no directory row                                  | skip `no_recipient`             |
 * | Pending password, no role row, or deactivated                      | skip `recipient_fenced`         |
 * | Active and stale                                                   | send `stalled` (`sent_stalled`) |
 * | `succeeded`, `failed`, `interrupted`, `stopped`                    | send that kind (`sent`)         |
 *
 * A viewer requester (demoted mid-solve) is not fenced: the email says "open the plan to review it",
 * which is true for a viewer too. Staleness is the plans hub's and the reclaim's threshold
 * (`isStaleActiveJob`), never a second one, and `nowMs` is injected so every boundary is testable.
 */
export type JobEmailKind = "finished" | "failed" | "interrupted" | "stopped" | "stalled";

/** How a job's email was settled without sending: `generation_jobs.email_outcome`'s skip values. */
export type JobEmailSkipOutcome =
  | "no_recipient"
  | "recipient_fenced"
  | "stopped_by_requester"
  | "dispatch_refused"
  | "expired";

/** Every `generation_jobs.email_outcome` value: the migration's check constraint lists the same seven. */
export type JobEmailOutcome = "sent" | "sent_stalled" | JobEmailSkipOutcome;

/**
 * How far back an event may be and still be emailed: 24 hours, and never more.
 *
 * It must not exceed Resend's idempotency window, which is also 24 hours. A job is due only within
 * this window of its event, and every send attempt happens after the event. So while the event stays
 * put, every retry of the same job falls inside the window of the `Idempotency-Key` its first attempt
 * used, and a send that succeeded but was never stamped does not go out twice. The window also keeps
 * a catch-up after an outage from mailing stale news.
 *
 * Two narrow gaps remain. Both need a successful send whose stamp never landed:
 * - **The event can move.** A stalled job's event is its heartbeat. If the job then ends, the event
 *   becomes `finished_at`. A retry inside the key's window carries a changed body, which Resend
 *   answers with 409 `invalid_idempotent_request`; the sweep reads that as already sent and stamps
 *   `sent`, not `sent_stalled`. Only if the stamp keeps failing for a whole day can a retry fall
 *   outside the window and send a second email.
 * - **Mailpit has no idempotency,** so locally and in CI such a retry is a second message.
 */
export const JOB_EMAIL_LOOKBACK_MS = 24 * 60 * 60_000;

/** The job's columns the decision reads, as the notifier selects them. */
export type JobEmailJobFacts = {
  status: GenerationJobStatus;
  requested_by: string | null;
  stop_requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
};

/** The requester's fences, as the notifier reads them from `user_directory` and `user_roles`. */
export type JobEmailRecipientFacts = {
  mustChangePassword: boolean;
  /** The requester's `user_roles` row, or null when they hold no role. */
  role: { deactivatedAt: string | null } | null;
};

export type JobEmailPhase =
  | { kind: "wait" }
  | { kind: "skip"; outcome: "expired" | "stopped_by_requester" | "dispatch_refused" }
  | { kind: "needs-recipient"; email: JobEmailKind };

export type NeedsRecipient = Extract<JobEmailPhase, { kind: "needs-recipient" }>;

export type JobEmailDecision =
  | { kind: "wait" }
  | { kind: "skip"; outcome: JobEmailSkipOutcome }
  | { kind: "send"; email: JobEmailKind };

/** The first stage, from the job alone: the table's first four rows, and the kind it would send. */
export function decideJobPhase(job: JobEmailJobFacts, nowMs: number): JobEmailPhase {
  if (isExpired(job, nowMs)) return { kind: "skip", outcome: "expired" };
  if (isActiveJobStatus(job.status) && !isStaleActiveJob(job, nowMs)) return { kind: "wait" };
  if (isStoppedByRequester(job)) return { kind: "skip", outcome: "stopped_by_requester" };
  if (isRefusedAtDispatch(job)) return { kind: "skip", outcome: "dispatch_refused" };
  return { kind: "needs-recipient", email: EMAIL_KIND[job.status] };
}

/**
 * The second stage, from the requester's account. `null` means there is nobody to email: the job
 * records no requester (it predates S-407, or they were deleted), or they have no directory row.
 * The fences are those `private.current_app_role()` folds into null for a caller, which the notifier
 * cannot ask about anyone else.
 */
export function decideRecipient(phase: NeedsRecipient, recipient: JobEmailRecipientFacts | null): JobEmailDecision {
  if (recipient === null) return { kind: "skip", outcome: "no_recipient" };
  if (isFenced(recipient)) return { kind: "skip", outcome: "recipient_fenced" };
  return { kind: "send", email: phase.email };
}

/** Both stages over one job, for a caller that already holds the recipient. */
export function decideJobEmail(
  job: JobEmailJobFacts,
  recipient: JobEmailRecipientFacts | null,
  nowMs: number,
): JobEmailDecision {
  const phase = decideJobPhase(job, nowMs);
  if (phase.kind !== "needs-recipient") return phase;
  return decideRecipient(phase, job.requested_by === null ? null : recipient);
}

/** The outcome a successful send of `email` records. */
export const sentOutcome = (email: JobEmailKind): "sent" | "sent_stalled" =>
  email === "stalled" ? "sent_stalled" : "sent";

/** An active row only reaches this map once it is stale, so both active statuses read as stalled. */
const EMAIL_KIND: Record<GenerationJobStatus, JobEmailKind> = {
  queued: "stalled",
  running: "stalled",
  succeeded: "finished",
  failed: "failed",
  interrupted: "interrupted",
  stopped: "stopped",
};

/**
 * The event is the terminal write (`finished_at`) for an ended job, and the last sign of life
 * (`heartbeat_at`) for an active one; `created_at` stands in for a row that never wrote either.
 * Exactly `JOB_EMAIL_LOOKBACK_MS` old is still due.
 */
const isExpired = (job: JobEmailJobFacts, nowMs: number): boolean => {
  const event = isActiveJobStatus(job.status) ? job.heartbeat_at : job.finished_at;
  return nowMs - Date.parse(event ?? job.created_at) > JOB_EMAIL_LOOKBACK_MS;
};

/** They pressed Stop on their own job, so they were watching when it ended. */
const isStoppedByRequester = (job: JobEmailJobFacts): boolean =>
  job.stop_requested_by !== null && job.stop_requested_by === job.requested_by;

/**
 * The solver never claimed it, so the author saw the refusal on screen when they pressed Generate.
 * Only the Worker's refused dispatch writes `failed` before `started_at`: the solver's terminal write
 * filters `status=eq.running`, and a reclaim writes `interrupted`.
 */
const isRefusedAtDispatch = (job: JobEmailJobFacts): boolean => job.status === "failed" && job.started_at === null;

/**
 * Pending, deactivated, or holding no role: with no role row `role?.deactivatedAt` is undefined, which
 * is not null, so a role-less requester is fenced too.
 */
const isFenced = ({ mustChangePassword, role }: JobEmailRecipientFacts): boolean =>
  mustChangePassword || role?.deactivatedAt !== null;
