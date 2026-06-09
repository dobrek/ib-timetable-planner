import { describe, expect, it } from "vitest";
import { countIncompleteCourses, deriveHours } from "./hours";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

const course = (id: string, hours: number): GroupingCourse => ({ id, teacherKey: "t", studentKeys: ["s"], hours });

const placement = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
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

describe("countIncompleteCourses", () => {
  it("counts courses with placed < required", () => {
    const placements = [placement("p1", "A", 1, 1)];
    const stats = deriveHours(placements, [course("A", 4), course("B", 2)]);
    expect(countIncompleteCourses(stats)).toBe(2); // A: 1/4, B: 0/2
  });

  it("does not count a fully-placed course", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2)];
    expect(countIncompleteCourses(deriveHours(placements, [course("A", 2)]))).toBe(0);
  });

  it("does not count an over-placed course", () => {
    const placements = [placement("p1", "A", 1, 1), placement("p2", "A", 1, 2), placement("p3", "A", 1, 3)];
    expect(countIncompleteCourses(deriveHours(placements, [course("A", 2)]))).toBe(0);
  });

  it("never counts a 0-hour merge-child as incomplete", () => {
    expect(countIncompleteCourses(deriveHours([], [course("M", 0)]))).toBe(0);
  });

  it("returns 0 for an empty catalog", () => {
    expect(countIncompleteCourses(deriveHours([], []))).toBe(0);
  });
});
