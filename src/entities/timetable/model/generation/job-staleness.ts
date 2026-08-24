import { isActiveJobStatus, type GenerationJobStatus } from "./job-status";

/**
 * When an active `generation_jobs` row has stopped being believable — the one place the grace and the
 * predicate are written down (S-304).
 *
 * Two page slices ask this question for two different reasons: plan-detail RECLAIMS a stale row (a
 * compare-and-set to `interrupted`, so the author's Generate is unblocked and the last checkpoint can
 * be delivered), and the plans hub merely DISPLAYS staleness. If those two ever disagreed the hub
 * would show a badge nobody can clear, or clear one the hub still shows — so the threshold lives in
 * the entity and both import it.
 *
 * **Why five minutes is a fact rather than a guess.** S-301's implementation review rejected a
 * staleness sweep on exactly the right grounds: *a wrong N fails healthy jobs*. What has changed is
 * the cadence underneath it. Before S-304 a row's heartbeat renewed only on a stage event — Mode A
 * alone can run 300 s between two — so any threshold short enough to be useful was also short enough
 * to kill a healthy solve. S-304's timer renews every 15 s, so five minutes is **twenty consecutive
 * missed beats**: a healthy container would have to be unreachable for twenty straight attempts to
 * look dead, and a genuinely dead one is detected in minutes rather than never.
 *
 * `now` is injected rather than read, so the predicate stays pure and its boundaries are testable.
 */
export const HEARTBEAT_GRACE_MS = 5 * 60_000;

export type ActiveJobTimestamps = {
  status: GenerationJobStatus;
  /** Renewed every `SOLVER_HEARTBEAT_INTERVAL_S` while a solve runs; null until the row is claimed. */
  heartbeat_at: string | null;
  /** The enqueue instant — the clock for a `queued` row, which has no heartbeat yet by definition. */
  created_at: string;
};

/**
 * Whether this row is an active job that has gone quiet for longer than the grace.
 *
 * The two branches measure from different clocks because the two failures are different. A `running`
 * row is being renewed by a live timer, so its heartbeat is the evidence — and a `running` row with
 * NO heartbeat is stale on sight, because the claim itself writes one (a null there means the row
 * predates S-303's writes, and nothing will ever renew it). A `queued` row has no heartbeat by
 * construction: it is stranded when the process that inserted it died before dispatching, so
 * `created_at` is the only clock there is.
 *
 * Terminal statuses are never stale — there is nothing left to go quiet.
 */
export const isStaleActiveJob = (row: ActiveJobTimestamps, nowMs: number): boolean => {
  if (!isActiveJobStatus(row.status)) return false;
  const since = row.status === "running" ? row.heartbeat_at : row.created_at;
  if (since === null) return true;
  const at = Date.parse(since);
  // An unparseable instant is not evidence of life — but it is not evidence of death either, and a
  // reclaim is a write. Treat it as fresh and let the next visit, with a readable timestamp, decide.
  if (Number.isNaN(at)) return false;
  return nowMs - at > HEARTBEAT_GRACE_MS;
};

/** The instant an active row must have been seen after to still count as alive. */
export const stalenessCutoff = (nowMs: number): string => new Date(nowMs - HEARTBEAT_GRACE_MS).toISOString();
