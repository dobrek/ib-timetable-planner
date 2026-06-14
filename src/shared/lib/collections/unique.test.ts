import { describe, expect, it } from "vitest";
import { unique } from "./unique";

describe("unique", () => {
  it("removes duplicates, preserving first-seen order", () => {
    expect(unique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
  });

  it("returns [] for an empty list", () => {
    expect(unique([])).toEqual([]);
  });
});
