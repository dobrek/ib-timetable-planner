import { describe, expect, it } from "vitest";
import { dayLabel } from "./day-label";

describe("dayLabel", () => {
  it("maps 1..7 to weekday abbreviations", () => {
    expect(dayLabel(1)).toBe("Mon");
    expect(dayLabel(5)).toBe("Fri");
    expect(dayLabel(7)).toBe("Sun");
  });

  it("falls back to 'Day N' beyond the week", () => {
    expect(dayLabel(8)).toBe("Day 8");
  });
});
