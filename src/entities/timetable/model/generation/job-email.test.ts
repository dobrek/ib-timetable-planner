import { describe, expect, it } from "vitest";
import {
  decideJobEmail,
  decideJobPhase,
  decideRecipient,
  JOB_EMAIL_LOOKBACK_MS,
  sentOutcome,
  type JobEmailJobFacts,
  type JobEmailRecipientFacts,
} from "./job-email";
import { HEARTBEAT_GRACE_MS } from "./job-staleness";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

const REQUESTER = "requester-id";
const ADMIN = "admin-id";

const job = (over: Partial<JobEmailJobFacts> = {}): JobEmailJobFacts => ({
  status: "succeeded",
  requested_by: REQUESTER,
  stop_requested_by: null,
  created_at: ago(30 * MINUTE),
  started_at: ago(29 * MINUTE),
  finished_at: ago(2 * MINUTE),
  heartbeat_at: ago(2 * MINUTE),
  ...over,
});

const author: JobEmailRecipientFacts = { mustChangePassword: false, role: { deactivatedAt: null } };

describe("decideJobEmail — the decision table, in order", () => {
  it("row 1: an event older than the lookback is expired, before anything else is asked", () => {
    // Stopped by the requester AND with no recipient, which rows 3 and 5 would also skip: expiry wins.
    const old = job({ finished_at: ago(JOB_EMAIL_LOOKBACK_MS + 1), stop_requested_by: REQUESTER, requested_by: null });

    expect(decideJobEmail(old, null, NOW)).toEqual({ kind: "skip", outcome: "expired" });
  });

  it("row 1: exactly the lookback old is still due", () => {
    expect(decideJobEmail(job({ finished_at: ago(JOB_EMAIL_LOOKBACK_MS) }), author, NOW)).toEqual({
      kind: "send",
      email: "finished",
    });
  });

  it("row 1: an active job is measured from its heartbeat, and a terminal one without finished_at from its creation", () => {
    const silent = job({ status: "running", heartbeat_at: ago(JOB_EMAIL_LOOKBACK_MS + 1) });
    expect(decideJobEmail(silent, author, NOW)).toEqual({ kind: "skip", outcome: "expired" });

    const unstamped = job({ status: "failed", finished_at: null, created_at: ago(JOB_EMAIL_LOOKBACK_MS + 1) });
    expect(decideJobEmail(unstamped, author, NOW)).toEqual({ kind: "skip", outcome: "expired" });
  });

  it("row 2: an active job with a fresh heartbeat waits, whoever asked to stop it", () => {
    for (const status of ["queued", "running"] as const) {
      const live = job({ status, finished_at: null, created_at: ago(MINUTE), heartbeat_at: ago(MINUTE) });
      expect(decideJobEmail(live, author, NOW), status).toEqual({ kind: "wait" });
      expect(decideJobEmail({ ...live, stop_requested_by: REQUESTER }, null, NOW), status).toEqual({ kind: "wait" });
    }
  });

  it("row 2: exactly the heartbeat grace is still alive, a millisecond more is stalled", () => {
    const atGrace = job({ status: "running", finished_at: null, heartbeat_at: ago(HEARTBEAT_GRACE_MS) });
    expect(decideJobEmail(atGrace, author, NOW)).toEqual({ kind: "wait" });

    const pastGrace = { ...atGrace, heartbeat_at: ago(HEARTBEAT_GRACE_MS + 1) };
    expect(decideJobEmail(pastGrace, author, NOW)).toEqual({ kind: "send", email: "stalled" });
  });

  it("row 3: a job its requester stopped is skipped, before the recipient is asked about", () => {
    const selfStopped = job({ status: "stopped", stop_requested_by: REQUESTER });

    expect(decideJobEmail(selfStopped, null, NOW)).toEqual({ kind: "skip", outcome: "stopped_by_requester" });
  });

  it("row 3: an admin's stop is emailed, and so is a stop by a since-deleted user", () => {
    expect(decideJobEmail(job({ status: "stopped", stop_requested_by: ADMIN }), author, NOW)).toEqual({
      kind: "send",
      email: "stopped",
    });
    // The stopper's account was deleted, so the FK set it null: nothing says the requester stopped it.
    expect(decideJobEmail(job({ status: "stopped", stop_requested_by: null }), author, NOW)).toEqual({
      kind: "send",
      email: "stopped",
    });
  });

  it("row 4: a job that failed before it started was refused at dispatch, before the recipient is asked about", () => {
    const refused = job({ status: "failed", started_at: null });

    expect(decideJobEmail(refused, null, NOW)).toEqual({ kind: "skip", outcome: "dispatch_refused" });
  });

  it("row 4: a job that failed after the solver claimed it is emailed", () => {
    expect(decideJobEmail(job({ status: "failed" }), author, NOW)).toEqual({ kind: "send", email: "failed" });
  });

  it("row 4: only `failed` reads a missing start as a refused dispatch", () => {
    // A stale queued row never started either: the dispatch was accepted and nothing claimed it.
    const staleQueued = job({ status: "queued", started_at: null, finished_at: null, heartbeat_at: null });
    expect(decideJobEmail(staleQueued, author, NOW)).toEqual({ kind: "send", email: "stalled" });

    const haltedUnstarted = job({ status: "interrupted", started_at: null });
    expect(decideJobEmail(haltedUnstarted, author, NOW)).toEqual({ kind: "send", email: "interrupted" });
  });

  it("row 5: no requester, or no directory row, is nobody to email", () => {
    expect(decideJobEmail(job({ requested_by: null }), author, NOW)).toEqual({ kind: "skip", outcome: "no_recipient" });
    expect(decideJobEmail(job(), null, NOW)).toEqual({ kind: "skip", outcome: "no_recipient" });
  });

  it("row 5: a legacy job with no requester is not 'stopped by its requester' when nobody stopped it", () => {
    expect(decideJobEmail(job({ requested_by: null, stop_requested_by: null }), null, NOW)).toEqual({
      kind: "skip",
      outcome: "no_recipient",
    });
  });

  it("row 6: a pending, role-less or deactivated requester is fenced", () => {
    const fenced: JobEmailRecipientFacts[] = [
      { mustChangePassword: true, role: { deactivatedAt: null } },
      { mustChangePassword: false, role: null },
      { mustChangePassword: false, role: { deactivatedAt: ago(MINUTE) } },
    ];
    for (const recipient of fenced) {
      expect(decideJobEmail(job(), recipient, NOW)).toEqual({ kind: "skip", outcome: "recipient_fenced" });
    }
  });

  it("row 7: a stale active job sends the stalled email, queued as well as running", () => {
    const staleRunning = job({ status: "running", finished_at: null, heartbeat_at: ago(10 * MINUTE) });
    expect(decideJobEmail(staleRunning, author, NOW)).toEqual({ kind: "send", email: "stalled" });

    // A queued row has no heartbeat: its clock is created_at, and the dispatch that should have
    // claimed it never did.
    const staleQueued = job({ status: "queued", finished_at: null, heartbeat_at: null, created_at: ago(10 * MINUTE) });
    expect(decideJobEmail(staleQueued, author, NOW)).toEqual({ kind: "send", email: "stalled" });
  });

  it("row 8: each terminal status sends its own kind", () => {
    const kinds = { succeeded: "finished", failed: "failed", interrupted: "interrupted", stopped: "stopped" } as const;
    for (const [status, email] of Object.entries(kinds)) {
      expect(decideJobEmail(job({ status: status as keyof typeof kinds }), author, NOW), status).toEqual({
        kind: "send",
        email,
      });
    }
  });

  it("emails a viewer requester: being demoted mid-solve is not a fence", () => {
    // Recipient facts carry no role name at all, so a viewer reads exactly like an author.
    expect(decideJobEmail(job(), { mustChangePassword: false, role: { deactivatedAt: null } }, NOW)).toEqual({
      kind: "send",
      email: "finished",
    });
  });
});

describe("the two stages", () => {
  it("decideJobPhase defers the recipient question with the kind it would send", () => {
    expect(decideJobPhase(job({ status: "interrupted" }), NOW)).toEqual({
      kind: "needs-recipient",
      email: "interrupted",
    });
  });

  it("decideRecipient keeps the kind the phase fixed", () => {
    expect(decideRecipient({ kind: "needs-recipient", email: "stalled" }, author)).toEqual({
      kind: "send",
      email: "stalled",
    });
  });

  it("a stalled send records sent_stalled, every other send records sent", () => {
    expect(sentOutcome("stalled")).toBe("sent_stalled");
    for (const kind of ["finished", "failed", "interrupted", "stopped"] as const) {
      expect(sentOutcome(kind)).toBe("sent");
    }
  });
});
