import { describe, expect, it } from "vitest";
import { distribution, worstOf } from "./stats";

describe("distribution", () => {
  it("medians an even-sized set to the midpoint of its two central values", () => {
    // The SQL v0 report's convention — golden dp1's students-per-slot median reads 14.5.
    expect(distribution([10, 14, 15, 30]).median).toBe(14.5);
  });

  it("summarizes an unsorted set", () => {
    expect(distribution([4, 1, 3, 2, 5])).toEqual({
      count: 5,
      min: 1,
      p10: 1.4,
      median: 3,
      mean: 3,
      max: 5,
      variance: 2,
    });
  });

  it("folds an empty set to all-zeros rather than NaN", () => {
    expect(distribution([])).toEqual({ count: 0, min: 0, p10: 0, median: 0, mean: 0, max: 0, variance: 0 });
  });
});

describe("worstOf", () => {
  it("picks the largest entry, keeping its identity", () => {
    const entries = [
      { key: "s1", value: 3 },
      { key: "s2", value: 9 },
      { key: "s3", value: 1 },
    ];

    expect(worstOf(entries)).toEqual({ key: "s2", value: 9 });
  });

  it("has no worst case when there is nothing to rank", () => {
    expect(worstOf([])).toBeNull();
  });
});
