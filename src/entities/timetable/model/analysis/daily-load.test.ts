import { describe, expect, it } from "vitest";
import { block, row } from "./__fixtures__/builders";
import { deriveDailyLoad } from "./daily-load";

describe("deriveDailyLoad", () => {
  it("separates hours (rows) from slots (distinct cells) per day", () => {
    // Day 1: three courses, two of them sharing P1 → 3 hours in 2 slots. Day 2: one hour, one slot.
    const rows = [row("dp1", "math", 1, 1), row("dp1", "bio", 1, 1), row("dp1", "art", 1, 2), row("dp1", "math", 2, 4)];

    const load = deriveDailyLoad(rows, 3);

    expect(load.hoursPerDay).toEqual([3, 1, 0]);
    expect(load.slotsPerDay).toEqual([2, 1, 0]);
  });

  it("summarizes the week's balance as distributions across days", () => {
    const rows = [...block("dp1", "math", 1, 1, 4), ...block("dp1", "bio", 2, 1, 2)];

    const load = deriveDailyLoad(rows, 2);

    expect(load.hours).toMatchObject({ count: 2, min: 2, max: 4, mean: 3, variance: 1 });
    expect(load.slots).toMatchObject({ count: 2, min: 2, max: 4 });
  });
});
