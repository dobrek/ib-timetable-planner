import { describe, expect, it } from "vitest";
import { BREAK_AFTER_PERIODS, breaksAfterPeriod } from "./period-breaks";

// `breaksAfterPeriod` is the only logic in the visual-breaks change: it decides where the cosmetic
// band renders and, via the `period < totalPeriods` guard, ensures no trailing break ever sits below
// the last row. Pin both the membership set and that boundary so they can't silently drift.
describe("breaksAfterPeriod", () => {
  it("breaks after the in-set periods (2 and 5) on a full 10-period grid", () => {
    expect(breaksAfterPeriod(2, 10)).toBe(true);
    expect(breaksAfterPeriod(5, 10)).toBe(true);
  });

  it("does not break after out-of-set periods", () => {
    expect(breaksAfterPeriod(1, 10)).toBe(false);
    expect(breaksAfterPeriod(3, 10)).toBe(false);
    expect(breaksAfterPeriod(4, 10)).toBe(false);
    expect(breaksAfterPeriod(6, 10)).toBe(false);
  });

  it("suppresses 'after 5' when 5 is the last row (5x6 → no; 5-period grid → yes-suppressed)", () => {
    expect(breaksAfterPeriod(5, 6)).toBe(true); // period 5 precedes period 6 → band renders
    expect(breaksAfterPeriod(5, 5)).toBe(false); // 5 < 5 is false → no trailing break below the last row
  });

  it("suppresses 'after 2' only when 2 is the last row (totalPeriods <= 2)", () => {
    expect(breaksAfterPeriod(2, 3)).toBe(true);
    expect(breaksAfterPeriod(2, 2)).toBe(false);
    expect(breaksAfterPeriod(2, 1)).toBe(false);
  });

  it("exposes the fixed break positions as [2, 5]", () => {
    expect(BREAK_AFTER_PERIODS).toEqual([2, 5]);
  });
});
