import { describe, expect, it } from "vitest";
import { buildCrossCohortIndex, EMPTY_CROSS_COHORT_INDEX, type SiblingOccupancyCell } from "./cross-cohort-index";

describe("buildCrossCohortIndex", () => {
  it("groups rows into teacherKey → cellKey → set of weeks", () => {
    const cells: SiblingOccupancyCell[] = [
      { teacherKey: "t1", day: 1, period: 1, week: "a" },
      { teacherKey: "t1", day: 1, period: 1, week: "b" },
      { teacherKey: "t1", day: 2, period: 3, week: "both" },
      { teacherKey: "t2", day: 1, period: 1, week: "both" },
    ];

    const index = buildCrossCohortIndex(cells);

    expect(index.get("t1")?.get("1:1")).toEqual(new Set(["a", "b"]));
    expect(index.get("t1")?.get("2:3")).toEqual(new Set(["both"]));
    expect(index.get("t2")?.get("1:1")).toEqual(new Set(["both"]));
  });

  it("collapses duplicate (teacher, cell, week) rows — the co-teacher-expanded projection may repeat", () => {
    const cells: SiblingOccupancyCell[] = [
      { teacherKey: "t1", day: 1, period: 1, week: "a" },
      { teacherKey: "t1", day: 1, period: 1, week: "a" },
    ];

    expect(buildCrossCohortIndex(cells).get("t1")?.get("1:1")).toEqual(new Set(["a"]));
  });

  it("returns an empty index for no cells", () => {
    expect(buildCrossCohortIndex([]).size).toBe(0);
    expect(EMPTY_CROSS_COHORT_INDEX.size).toBe(0);
  });
});
