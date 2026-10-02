import { describe, expect, it } from "vitest";
import type { JournalEntry } from "./journal.ts";
import { replay } from "./journal.ts";
import { formatStatus } from "./status-report.ts";

/**
 * `status` is what the operator reads before deciding to `park`, so it must never say "no override"
 * while one may be live: an apply whose `secret bulk` ran but whose outcome was never written.
 */
const AT = "2026-10-01T08:00:00.000Z";
const SET_UP: readonly JournalEntry[] = [
  {
    type: "intent",
    seq: 1,
    at: AT,
    action: { kind: "setup", target: "production", sourcePlanId: "source", name: "Calibration — test" },
  },
  { type: "outcome", seq: 1, at: AT, result: { kind: "setup", campaignPlanId: "campaign", remainingHours: 40 } },
];

describe("formatStatus", () => {
  it("reports an override as possibly live while its apply is still open", () => {
    const state = replay([
      ...SET_UP,
      {
        type: "intent",
        seq: 2,
        at: AT,
        action: { kind: "apply-cell", cell: "B", tuning: { workers: 4, stageBudgetS: 60, modeABudgetS: 300 } },
      },
    ]);

    expect(formatStatus(state, "production", Date.parse(AT))).toMatch(/^override POSSIBLY cell B/m);
  });

  it("reports no override when nothing was applied", () => {
    expect(formatStatus(replay(SET_UP), "production", Date.parse(AT))).toMatch(/^override none/m);
  });
});
