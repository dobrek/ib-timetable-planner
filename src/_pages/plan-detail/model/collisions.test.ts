import { describe, expect, it } from "vitest";
import { cellKey, deriveCellViolations } from "./collisions";
import type { CellCollisions } from "./collisions";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

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

describe("deriveCellViolations", () => {
  it("flags both courses when two in a cell share a student", () => {
    const cat = catalog(course("A", "t1", ["s1", "s2"]), course("B", "t2", ["s2", "s3"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))?.conflictingIds).toEqual(new Set(["A", "B"]));
    expect(result.get(cellKey(1, 1))?.violations).toEqual([
      { kind: "student", studentKeys: ["s2"], courseIds: ["A", "B"] },
    ]);
  });

  it("flags both courses when two in a cell share a teacher", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s2"]));
    const result = deriveCellViolations([placement("p1", "A", 2, 3), placement("p2", "B", 2, 3)], cat);
    expect(result.get(cellKey(2, 3))?.conflictingIds).toEqual(new Set(["A", "B"]));
    expect(result.get(cellKey(2, 3))?.violations).toEqual([
      { kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] },
    ]);
  });

  it("does not flag a collision-free multi-occupancy cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s2"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.has(cellKey(1, 1))).toBe(false);
  });

  it("only flags the conflicting pair in a mixed cell (attribution)", () => {
    // A and B share s1; C is independent.
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]), course("C", "t3", ["s9"]));
    const result = deriveCellViolations(
      [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1), placement("p3", "C", 1, 1)],
      cat,
    );
    expect(result.get(cellKey(1, 1))?.conflictingIds).toEqual(new Set(["A", "B"]));
  });

  it("does not flag the same students across different cells (per-cell scope)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 2, 2)], cat);
    expect(result.size).toBe(0);
  });

  it("clears the flag when a participant leaves the cell (recompute)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const placements = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)];
    expect(deriveCellViolations(placements, cat).get(cellKey(1, 1))?.conflictingIds).toEqual(new Set(["A", "B"]));

    const afterMove = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 2)];
    expect(deriveCellViolations(afterMove, cat).size).toBe(0);
  });

  it("does not flag a single-occupant cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    expect(deriveCellViolations([placement("p1", "A", 1, 1)], cat).size).toBe(0);
  });

  it("skips placements whose course is absent from the catalog", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "GHOST", 1, 1)], cat);
    expect(result.size).toBe(0);
  });

  it("reports a duplicated course placed twice in the same cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "A", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))?.conflictingIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.violations).toContainEqual({ kind: "duplicate-course", courseId: "A" });
  });

  it("keeps conflictingIds equal to the union of violation course ids (invariant)", () => {
    const cat = catalog(
      course("A", "t1", ["s1", "s2"]),
      course("B", "t1", ["s3"]),
      course("C", "t2", ["s2"]),
      course("D", "t3", ["s9"]),
    );
    const result = deriveCellViolations(
      [
        placement("p1", "A", 1, 1),
        placement("p2", "B", 1, 1),
        placement("p3", "C", 1, 1),
        placement("p4", "D", 1, 1),
        placement("p5", "A", 2, 2),
        placement("p6", "A", 2, 2),
      ],
      cat,
    );
    for (const cell of result.values()) {
      expect(cell.conflictingIds).toEqual(unionOfViolationCourseIds(cell));
    }
    expect(result.get(cellKey(1, 1))?.conflictingIds).toEqual(new Set(["A", "B", "C"]));
  });
});

const unionOfViolationCourseIds = (cell: CellCollisions): Set<string> => {
  const ids = new Set<string>();
  for (const violation of cell.violations) {
    if (violation.kind === "duplicate-course") ids.add(violation.courseId);
    else for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};
