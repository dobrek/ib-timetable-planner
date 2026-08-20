import { describe, expect, it } from "vitest";
import { parseStoredStages, storedStageReportSchema } from "./stage-report";

const stage = (overrides: Record<string, unknown> = {}) => ({
  tier: 4,
  name: "teacherHoles",
  status: "OPTIMAL",
  best: 97,
  bound: 97,
  wallClockS: 1.5,
  ...overrides,
});

describe("storedStageReportSchema", () => {
  it("accepts a report with the optional stoppedBy", () => {
    expect(storedStageReportSchema.safeParse(stage({ status: "FEASIBLE", stoppedBy: "target" })).success).toBe(true);
  });

  it("accepts a report with every optional omitted", () => {
    expect(
      storedStageReportSchema.safeParse({ tier: 2, name: "holes", status: "UNKNOWN", wallClockS: 10 }).success,
    ).toBe(true);
  });

  it("rejects a missing wallClockS — it is required on the wire", () => {
    expect(storedStageReportSchema.safeParse(stage({ wallClockS: undefined })).success).toBe(false);
  });

  it("rejects an unknown key, mirroring additionalProperties: false", () => {
    expect(storedStageReportSchema.safeParse(stage({ elapsedMs: 1500 })).success).toBe(false);
  });

  it("rejects a stoppedBy outside the contract's enum", () => {
    expect(storedStageReportSchema.safeParse(stage({ stoppedBy: "stagnation" })).success).toBe(false);
  });

  it("rejects a nulled optional — this wire omits, never nulls", () => {
    expect(storedStageReportSchema.safeParse(stage({ best: null })).success).toBe(false);
  });
});

describe("parseStoredStages", () => {
  it("returns the parsed transcript when the column is well-formed", () => {
    expect(parseStoredStages([stage()])).toEqual([stage()]);
  });

  it("degrades a malformed transcript to an empty one rather than throwing", () => {
    // The board is still deliverable when its diagnostics are unreadable — `deriveCleanLabel` then
    // reports `unavailable`, which is the honest answer.
    expect(parseStoredStages([{ tier: "four" }])).toEqual([]);
    expect(parseStoredStages(null)).toEqual([]);
    expect(parseStoredStages({ stages: [] })).toEqual([]);
  });

  it("treats an empty transcript as empty rather than malformed", () => {
    expect(parseStoredStages([])).toEqual([]);
  });
});
