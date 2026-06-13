import { describe, expect, it } from "vitest";
import { cellKey } from "./collisions";
import { deriveDropHints, type DragHintContext } from "./drop-hints";
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

describe("deriveDropHints", () => {
  it("returns null when no drag is active", () => {
    expect(deriveDropHints(null, [], catalog())).toBeNull();
  });

  it("marks an empty grid entirely free (empty map)", () => {
    const a = course("A", "t1", ["s1"]);
    const result = deriveDropHints({ members: [a] }, [], catalog(a));
    expect(result?.size).toBe(0);
  });

  it("blocks a cell whose occupant shares the dragged course's teacher", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t1", ["s2"]);
    const result = deriveDropHints({ members: [a] }, [placement("p1", "B", 1, 1)], catalog(a, b));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("omits a collision-free occupied cell (free)", () => {
    const a = course("A", "t1", ["s1"]);
    const c = course("C", "t2", ["s9"]);
    const result = deriveDropHints({ members: [a] }, [placement("p1", "C", 1, 1)], catalog(a, c));
    expect(result?.has(cellKey(1, 1))).toBe(false);
    expect(result?.size).toBe(0);
  });

  it("blocks a cell already holding the dragged course (duplicate-course registry constraint)", () => {
    const a = course("A", "t1", ["s1"]);
    const result = deriveDropHints({ members: [a] }, [placement("p1", "A", 1, 1)], catalog(a));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("excludes the dragged placement from its origin so the cell would otherwise compute free", () => {
    // Without exclusion, (1,1) holds A and would read blocked as a duplicate-of-self.
    const a = course("A", "t1", ["s1"]);
    const context: DragHintContext = { members: [a], excludePlacementId: "p1" };
    const result = deriveDropHints(context, [placement("p1", "A", 1, 1)], catalog(a));
    expect(result?.has(cellKey(1, 1))).toBe(false);
  });

  it("forces the placement-move origin blocked (same-cell no-op)", () => {
    const a = course("A", "t1", ["s1"]);
    const context: DragHintContext = { members: [a], excludePlacementId: "p1", origin: { day: 1, period: 1 } };
    const result = deriveDropHints(context, [placement("p1", "A", 1, 1)], catalog(a));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("marks a group cell free when every member fits", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const c = course("C", "t3", ["s9"]);
    const result = deriveDropHints({ members: [a, b] }, [placement("p1", "C", 1, 1)], catalog(a, b, c));
    expect(result?.has(cellKey(1, 1))).toBe(false);
  });

  it("marks a group cell partial when only some members fit", () => {
    // X shares teacher t1 with A only; B (t2) is free against X.
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const x = course("X", "t1", ["s9"]);
    const result = deriveDropHints({ members: [a, b] }, [placement("p1", "X", 1, 1)], catalog(a, b, x));
    expect(result?.get(cellKey(1, 1))).toBe("partial");
  });

  it("marks a group cell blocked when no member fits", () => {
    // X conflicts with A (teacher t1); Y conflicts with B (teacher t2).
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const x = course("X", "t1", ["s9"]);
    const y = course("Y", "t2", ["s8"]);
    const result = deriveDropHints(
      { members: [a, b] },
      [placement("p1", "X", 1, 1), placement("p2", "Y", 1, 1)],
      catalog(a, b, x, y),
    );
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });
});
