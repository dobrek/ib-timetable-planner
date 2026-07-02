import { describe, expect, it } from "vitest";
import { deriveHours, deriveOverplaced, deriveUnplaced, summarizeHours } from "./hours";
import type { GroupingCourse } from "./grouping/grouping";
import type { PlannerPlacement } from "./placement/placement";

const course = (id: string, hours: number): GroupingCourse => ({
  id,
  teacherKeys: ["t"],
  studentKeys: ["s"],
  hours,
  weekMode: "agnostic",
});

const placement = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
});

describe("deriveHours", () => {
  it("reports placed < required", () => {
    const stats = deriveHours([placement("p1", "A", 1, 1)], [course("A", 5)]);
    expect(stats.get("A")).toEqual({ placed: 1, required: 5 });
  });

  it("reports placed = required", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2)];
    expect(deriveHours(placements, [course("A", 2)]).get("A")).toEqual({ placed: 2, required: 2 });
  });

  it("reports placed > required (over-placement is surfaced, not blocked)", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2), placement("p3", "A", 1, 3)];
    expect(deriveHours(placements, [course("A", 2)]).get("A")).toEqual({ placed: 3, required: 2 });
  });

  it("reports 0 placed for a course with no placements", () => {
    expect(deriveHours([], [course("A", 4)]).get("A")).toEqual({ placed: 0, required: 4 });
  });

  it("special-cases a 0-hour merge-child (required 0, no warning)", () => {
    const stats = deriveHours([placement("p1", "M", 1, 1)], [course("M", 0)]);
    expect(stats.get("M")).toEqual({ placed: 1, required: 0 });
  });

  it("counts one placed hour per row across multiple cells", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 2, 1), placement("p3", "A", 3, 1)];
    expect(deriveHours(placements, [course("A", 6)]).get("A")?.placed).toBe(3);
  });

  it("keys only catalog courses, ignoring placements outside the catalog", () => {
    const stats = deriveHours([placement("p1", "GHOST", 1, 1)], [course("A", 4)]);
    expect(stats.has("GHOST")).toBe(false);
    expect(stats.get("A")).toEqual({ placed: 0, required: 4 });
  });
});

const idsOf = (rows: { courseId: string }[]) => rows.map((row) => row.courseId);

describe("deriveUnplaced", () => {
  it("returns only the courses still needing board hours", () => {
    const stats = deriveHours([placement("p1", "A", 1, 1)], [course("A", 4), course("B", 2)]);
    expect(idsOf(deriveUnplaced(stats))).toEqual(["A", "B"]); // A: 1/4, B: 0/2
  });

  it("excludes a fully-placed course", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2)];
    expect(deriveUnplaced(deriveHours(placements, [course("A", 2)]))).toEqual([]);
  });

  it("excludes an over-placed course", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2), placement("p3", "A", 1, 3)];
    expect(deriveUnplaced(deriveHours(placements, [course("A", 2)]))).toEqual([]);
  });

  it("carries the placed/required hours for each returned course", () => {
    const stats = deriveHours([placement("p1", "A", 1, 1)], [course("A", 4)]);
    expect(deriveUnplaced(stats)).toEqual([{ courseId: "A", placed: 1, required: 4 }]);
  });
});

describe("deriveOverplaced", () => {
  it("returns only the courses with too many board hours", () => {
    const overA = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2), placement("p3", "A", 1, 3)];
    const stats = deriveHours(overA, [course("A", 2), course("B", 2)]);
    expect(deriveOverplaced(stats)).toEqual([{ courseId: "A", placed: 3, required: 2 }]); // B is only 0/2
  });

  it("excludes an exactly-placed course", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2)];
    expect(deriveOverplaced(deriveHours(placements, [course("A", 2)]))).toEqual([]);
  });

  it("never flags a placed 0-hour merge-child (required 0) as over-placed", () => {
    // The `required > 0` guard: a dropped 0-hour child reads as {placed:1, required:0}; a naive
    // `placed > required` (1 > 0) would spuriously flag it. This is the case the guard exists for.
    const stats = deriveHours([placement("p1", "M", 1, 1)], [course("M", 0)]);
    expect(stats.get("M")).toEqual({ placed: 1, required: 0 });
    expect(deriveOverplaced(stats)).toEqual([]);
  });
});

describe("summarizeHours", () => {
  it("never nets over-placement against under-placement (Math+English)", () => {
    // Math over-placed 4/2, English under-placed 0/2 → must read "2 left · 2 over", not cancel to 0.
    const mathPlacements = [
      placement("p1", "MATH", 1, 1),
      placement("p2", "MATH", 1, 2),
      placement("p3", "MATH", 1, 3),
      placement("p4", "MATH", 1, 4),
    ];
    const stats = deriveHours(mathPlacements, [course("MATH", 2), course("ENG", 2)]);
    expect(summarizeHours(stats)).toEqual({ hoursLeft: 2, hoursOver: 2 });
  });

  it("counts a placed 0-hour merge-child as 0 on both sides", () => {
    const stats = deriveHours([placement("p1", "M", 1, 1)], [course("M", 0)]);
    expect(summarizeHours(stats)).toEqual({ hoursLeft: 0, hoursOver: 0 });
  });

  it("returns zeros for an empty catalog", () => {
    const stats = deriveHours([], []);
    expect(summarizeHours(stats)).toEqual({ hoursLeft: 0, hoursOver: 0 });
    expect(deriveUnplaced(stats)).toEqual([]);
    expect(deriveOverplaced(stats)).toEqual([]);
  });
});
