import { describe, expect, it } from "vitest";
import { indexFromPlacements } from "./use-cohort-board-state";
import type { LocalPlacement } from "./placement";

// The live cross-index seam: each cohort's `occupiedByTeacher` is built from the OTHER column's
// current placements. These lock the property the combined shell relies on — editing one cohort's
// placements yields an index reflecting the change (so the sibling re-validates).
const teacherKeys = new Map([
  ["c1", ["shared"]],
  ["c2", ["other"]],
]);

const placement = (courseId: string, day: number, period: number): LocalPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
});

describe("indexFromPlacements (live cross-cohort index)", () => {
  it("marks the cell+week a shared teacher is occupied at in the source cohort", () => {
    const index = indexFromPlacements([placement("c1", 2, 3)], teacherKeys);
    expect(index.get("shared")?.get("2:3")).toEqual(new Set(["both"]));
  });

  it("recomputes to a different occupancy when the source cohort's placement moves", () => {
    const before = indexFromPlacements([placement("c1", 2, 3)], teacherKeys);
    const after = indexFromPlacements([placement("c1", 4, 5)], teacherKeys);

    expect(before.get("shared")?.has("2:3")).toBe(true);
    expect(after.get("shared")?.has("2:3")).toBe(false);
    expect(after.get("shared")?.has("4:5")).toBe(true);
    // A fresh Map identity each build — the memo that wraps this forces sibling re-validation.
    expect(after).not.toBe(before);
  });

  it("yields an empty index when the source cohort has no placements", () => {
    expect(indexFromPlacements([], teacherKeys).size).toBe(0);
  });
});
