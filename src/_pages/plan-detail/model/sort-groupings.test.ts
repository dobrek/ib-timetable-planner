import { describe, expect, it } from "vitest";
import { sortGroupingsForPalette } from "./sort-groupings";
import type { PlannerGrouping } from "./grouping";

const grouping = (id: string, coverageCount: number, courseCount: number): PlannerGrouping => ({
  id,
  coverageCount,
  memberIds: Array.from({ length: courseCount }, (_, i) => `${id}-c${i}`),
  score: 0,
  oppositeWeek: false,
});

describe("sortGroupingsForPalette", () => {
  it("orders by total students descending (primary key)", () => {
    const sorted = sortGroupingsForPalette([grouping("a", 3, 1), grouping("b", 9, 1), grouping("c", 6, 1)]);
    expect(sorted.map((g) => g.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks equal student totals by course count descending (secondary key)", () => {
    const sorted = sortGroupingsForPalette([grouping("a", 6, 2), grouping("b", 6, 4), grouping("c", 6, 3)]);
    expect(sorted.map((g) => g.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks equal students and courses by id ascending (tertiary key)", () => {
    const sorted = sortGroupingsForPalette([grouping("c", 6, 2), grouping("a", 6, 2), grouping("b", 6, 2)]);
    expect(sorted.map((g) => g.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [grouping("a", 3, 1), grouping("b", 9, 1)];
    const original = input.map((g) => g.id);
    sortGroupingsForPalette(input);
    expect(input.map((g) => g.id)).toEqual(original);
  });

  it("returns an empty array unchanged", () => {
    expect(sortGroupingsForPalette([])).toEqual([]);
  });
});
