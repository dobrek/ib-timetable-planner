import { describe, expect, it } from "vitest";
import { GENERATION_JOB_STATUSES, type GenerationJobStatus } from "./job-status";
import { HEARTBEAT_GRACE_MS, isStaleActiveJob, stalenessCutoff } from "./job-staleness";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const row = (over: Partial<Parameters<typeof isStaleActiveJob>[0]> = {}) => ({
  status: "running" as GenerationJobStatus,
  heartbeat_at: ago(1_000),
  created_at: ago(60_000),
  ...over,
});

describe("isStaleActiveJob", () => {
  it("leaves a running job whose heartbeat is fresh alone", () => {
    expect(isStaleActiveJob(row({ heartbeat_at: ago(14_000) }), NOW)).toBe(false);
  });

  it("calls a running job stale once its heartbeat is older than the grace", () => {
    expect(isStaleActiveJob(row({ heartbeat_at: ago(HEARTBEAT_GRACE_MS + 1) }), NOW)).toBe(true);
  });

  it("holds the boundary itself as still alive", () => {
    // Exactly at the grace is twenty missed beats and not one more — a strict comparison keeps the
    // reclaim from ever racing a beat that is landing right now.
    expect(isStaleActiveJob(row({ heartbeat_at: ago(HEARTBEAT_GRACE_MS) }), NOW)).toBe(false);
  });

  it("treats a running job with no heartbeat at all as stale", () => {
    // The claim itself writes one, so a null here can only be a row nothing will ever renew.
    expect(isStaleActiveJob(row({ heartbeat_at: null }), NOW)).toBe(true);
  });

  it("measures a queued job from created_at, because it has no heartbeat by construction", () => {
    // The stranded-`queued` window: the process died between the insert and the dispatch.
    expect(isStaleActiveJob(row({ status: "queued", heartbeat_at: null, created_at: ago(60_000) }), NOW)).toBe(false);
    expect(
      isStaleActiveJob(row({ status: "queued", heartbeat_at: null, created_at: ago(HEARTBEAT_GRACE_MS + 1) }), NOW),
    ).toBe(true);
  });

  it("ignores a queued row's heartbeat even when one somehow exists", () => {
    // A row re-queued by hand could carry an old heartbeat; `created_at` is still the honest clock.
    expect(
      isStaleActiveJob(
        row({ status: "queued", heartbeat_at: ago(HEARTBEAT_GRACE_MS + 1), created_at: ago(1_000) }),
        NOW,
      ),
    ).toBe(false);
  });

  it.each(GENERATION_JOB_STATUSES.filter((status) => status !== "queued" && status !== "running"))(
    "never calls a %s job stale — there is nothing left to go quiet",
    (status) => {
      expect(isStaleActiveJob(row({ status, heartbeat_at: ago(HEARTBEAT_GRACE_MS * 100) }), NOW)).toBe(false);
    },
  );

  it("treats an unparseable instant as fresh rather than reclaiming on it", () => {
    // Not evidence of life — but a reclaim is a WRITE, and guessing wrong there fails a healthy job.
    expect(isStaleActiveJob(row({ heartbeat_at: "not a timestamp" }), NOW)).toBe(false);
  });
});

describe("stalenessCutoff", () => {
  it("is the instant an active row must have been seen after to still count as alive", () => {
    expect(stalenessCutoff(NOW)).toBe(new Date(NOW - HEARTBEAT_GRACE_MS).toISOString());
  });

  it("agrees with the predicate at the boundary", () => {
    // The CAS filters on this string while the predicate decides in memory; a disagreement between
    // them would show up as a reclaim that matches no row, forever.
    const cutoff = stalenessCutoff(NOW);
    expect(isStaleActiveJob(row({ heartbeat_at: cutoff }), NOW)).toBe(false);
    expect(isStaleActiveJob(row({ heartbeat_at: new Date(Date.parse(cutoff) - 1).toISOString() }), NOW)).toBe(true);
  });
});
