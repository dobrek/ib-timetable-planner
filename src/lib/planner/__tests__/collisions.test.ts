import { describe, expect, it } from "vitest";
import { cellKey, deriveCollisions } from "../collisions";
import type { GroupingCourse } from "@/entities/grouping";
import type { PlannerPlacement } from "@/entities/placement";

const course = (id: string, teacherKey: string | null, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKey,
  studentKeys,
  hours: 4,
});

const placement = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
});

const catalog = (...courses: GroupingCourse[]): Map<string, GroupingCourse> => new Map(courses.map((c) => [c.id, c]));

describe("deriveCollisions", () => {
  it("flags both courses when two in a cell share a student", () => {
    const cat = catalog(course("A", "t1", ["s1", "s2"]), course("B", "t2", ["s2", "s3"]));
    const result = deriveCollisions([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))).toEqual(new Set(["A", "B"]));
  });

  it("flags both courses when two in a cell share a teacher", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s2"]));
    const result = deriveCollisions([placement("p1", "A", 2, 3), placement("p2", "B", 2, 3)], cat);
    expect(result.get(cellKey(2, 3))).toEqual(new Set(["A", "B"]));
  });

  it("does not flag a collision-free multi-occupancy cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s2"]));
    const result = deriveCollisions([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.has(cellKey(1, 1))).toBe(false);
  });

  it("only flags the conflicting pair in a mixed cell (attribution)", () => {
    // A and B share s1; C is independent.
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]), course("C", "t3", ["s9"]));
    const result = deriveCollisions(
      [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1), placement("p3", "C", 1, 1)],
      cat,
    );
    expect(result.get(cellKey(1, 1))).toEqual(new Set(["A", "B"]));
  });

  it("does not flag the same students across different cells (per-cell scope)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const result = deriveCollisions([placement("p1", "A", 1, 1), placement("p2", "B", 2, 2)], cat);
    expect(result.size).toBe(0);
  });

  it("clears the flag when a participant leaves the cell (recompute)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const placements = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)];
    expect(deriveCollisions(placements, cat).get(cellKey(1, 1))).toEqual(new Set(["A", "B"]));

    const afterMove = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 2)];
    expect(deriveCollisions(afterMove, cat).size).toBe(0);
  });

  it("does not flag a single-occupant cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    expect(deriveCollisions([placement("p1", "A", 1, 1)], cat).size).toBe(0);
  });

  it("skips placements whose course is absent from the catalog", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const result = deriveCollisions([placement("p1", "A", 1, 1), placement("p2", "GHOST", 1, 1)], cat);
    expect(result.size).toBe(0);
  });
});
