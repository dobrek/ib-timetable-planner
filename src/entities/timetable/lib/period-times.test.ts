import { describe, expect, it } from "vitest";
import { BREAK_AFTER_PERIODS } from "./period-breaks";
import { periodTimeRange, type PeriodTimeRange } from "./period-times";

describe("periodTimeRange", () => {
  it("maps the first period to the schedule start", () => {
    expect(periodTimeRange(1)).toEqual({ start: "08:00", end: "08:45" });
  });

  it("maps the last period of the placeholder schedule", () => {
    expect(periodTimeRange(10)).toEqual({ start: "16:10", end: "16:55" });
  });

  it("covers every period of the largest grid preset with 45-minute ranges", () => {
    for (let period = 1; period <= 10; period++) {
      const range = requireRange(period);
      expect(minutesBetween(range.start, range.end)).toBe(45);
    }
  });

  it("leaves a longer gap after each visual break period than between adjacent periods", () => {
    const plainGap = gapAfter(1); // P1 → P2, no break between them
    for (const breakPeriod of BREAK_AFTER_PERIODS) {
      expect(gapAfter(breakPeriod)).toBeGreaterThan(plainGap);
    }
  });

  it("returns null outside the schedule", () => {
    expect(periodTimeRange(0)).toBeNull();
    expect(periodTimeRange(11)).toBeNull();
    expect(periodTimeRange(-3)).toBeNull();
  });
});

const minutesBetween = (start: string, end: string): number => toMinutes(end) - toMinutes(start);

const gapAfter = (period: number): number =>
  toMinutes(requireRange(period + 1).start) - toMinutes(requireRange(period).end);

const requireRange = (period: number): PeriodTimeRange => {
  const range = periodTimeRange(period);
  if (!range) throw new Error(`expected a time range for period ${period}`);
  return range;
};

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
