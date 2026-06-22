import { describe, expect, it } from "vitest";
import { cellKey, deriveCellViolations } from "./collisions";
import { catalog, course, placement, unionOfViolationCourseIds } from "./__fixtures__/builders";

describe("deriveCellViolations", () => {
  it("flags both courses when two in a cell share a student", () => {
    const cat = catalog(course("A", "t1", ["s1", "s2"]), course("B", "t2", ["s2", "s3"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));
    expect(result.get(cellKey(1, 1))?.violations).toEqual([
      { kind: "student", studentKeys: ["s2"], courseIds: ["A", "B"] },
    ]);
  });

  it("flags both courses when two in a cell share a teacher", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s2"]));
    const result = deriveCellViolations([placement("p1", "A", 2, 3), placement("p2", "B", 2, 3)], cat);
    expect(result.get(cellKey(2, 3))?.blockingIds).toEqual(new Set(["A", "B"]));
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
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));
  });

  it("does not flag the same students across different cells (per-cell scope)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 2, 2)], cat);
    expect(result.size).toBe(0);
  });

  it("clears the flag when a participant leaves the cell (recompute)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const placements = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)];
    expect(deriveCellViolations(placements, cat).get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));

    const afterMove = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 2)];
    expect(deriveCellViolations(afterMove, cat).size).toBe(0);
  });

  it("does not flag a single-occupant cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    expect(deriveCellViolations([placement("p1", "A", 1, 1)], cat).size).toBe(0);
  });

  it("threads placement week: an opposite-week pair sharing a teacher and students does not collide", () => {
    const cat = catalog(course("A", "t1", ["s1", "s2"]), course("B", "t1", ["s2", "s3"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")], cat);
    expect(result.has(cellKey(1, 1))).toBe(false);
  });

  it("threads placement week: the same pair on the same week still collides", () => {
    const cat = catalog(course("A", "t1", ["s1", "s2"]), course("B", "t1", ["s2", "s3"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "a")], cat);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));
  });

  it("clears the flag when a participant moves to the other week (recompute)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t2", ["s1"]));
    const sameWeek = [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "a")];
    expect(deriveCellViolations(sameWeek, cat).get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));

    const opposite = [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")];
    expect(deriveCellViolations(opposite, cat).size).toBe(0);
  });

  it("an agnostic (both) course still collides with a single-week course sharing a teacher", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s2"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1, "both"), placement("p2", "B", 1, 1, "a")], cat);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));
  });

  it("skips placements whose course is absent from the catalog", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "GHOST", 1, 1)], cat);
    expect(result.size).toBe(0);
  });

  it("reports a duplicated course placed twice in the same cell", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "A", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.violations).toContainEqual({ kind: "duplicate-course", courseId: "A" });
  });

  it("flags a single-occupant cell when the teacher is strong-unavailable there", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const availability = {
      strongUnavailableByTeacher: new Map([["t1", new Set(["1:1"])]]),
      softUnavailableByTeacher: new Map<string, Set<string>>(),
    };
    const result = deriveCellViolations([placement("p1", "A", 1, 1)], cat, availability);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.unavailableIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.violations).toEqual([
      { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "block" },
    ]);
  });

  it("leaves unavailableIds empty for a plain collision (only teacher-unavailable populates it)", () => {
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s2"]));
    const result = deriveCellViolations([placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], cat);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B"]));
    expect(result.get(cellKey(1, 1))?.unavailableIds).toEqual(new Set());
  });

  it("flags a soft-unavailable cell as warn only — not blocking, never invalid", () => {
    const cat = catalog(course("A", "t1", ["s1"]));
    const availability = {
      strongUnavailableByTeacher: new Map<string, Set<string>>(),
      softUnavailableByTeacher: new Map([["t1", new Set(["1:1"])]]),
    };
    const result = deriveCellViolations([placement("p1", "A", 1, 1)], cat, availability);
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set()); // never invalid
    expect(result.get(cellKey(1, 1))?.warningIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.unavailableIds).toEqual(new Set(["A"]));
    expect(result.get(cellKey(1, 1))?.violations).toEqual([
      { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "warn" },
    ]);
  });

  it("splits blocking and warn ids: their union is the full violation set, warn excluded from blocking", () => {
    // A & B collide (shared teacher → block); C is soft-unavailable at the cell (warn).
    const cat = catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s3"]), course("C", "t2", ["s9"]));
    const availability = {
      strongUnavailableByTeacher: new Map<string, Set<string>>(),
      softUnavailableByTeacher: new Map([["t2", new Set(["1:1"])]]),
    };
    const result = deriveCellViolations(
      [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1), placement("p3", "C", 1, 1)],
      cat,
      availability,
    );
    const cell = result.get(cellKey(1, 1));
    if (!cell) throw new Error("expected a violation cell at (1,1)");
    expect(cell.blockingIds).toEqual(new Set(["A", "B"]));
    expect(cell.warningIds).toEqual(new Set(["C"]));
    // Union invariant: blocking ∪ warn === every course id across the violations.
    expect(new Set([...cell.blockingIds, ...cell.warningIds])).toEqual(unionOfViolationCourseIds(cell));
    // Warn id is excluded from blocking (stays valid).
    expect(cell.blockingIds.has("C")).toBe(false);
  });

  it("keeps blocking ∪ warn equal to the union of violation course ids (invariant)", () => {
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
      expect(new Set([...cell.blockingIds, ...cell.warningIds])).toEqual(unionOfViolationCourseIds(cell));
    }
    expect(result.get(cellKey(1, 1))?.blockingIds).toEqual(new Set(["A", "B", "C"]));
  });
});
