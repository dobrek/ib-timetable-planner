import { describe, expect, it } from "vitest";
import { cellKey } from "./collisions";
import { deriveDropHints, resolveDragHintContext, type DragHintContext } from "./drop-hints";
import type { GroupingCourse, PlannerGrouping } from "./grouping";
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

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({ id, memberIds, coverageCount: 1, score: 1 });

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
    const context: DragHintContext = { members: [a], excludePlacementIds: ["p1"] };
    const result = deriveDropHints(context, [placement("p1", "A", 1, 1)], catalog(a));
    expect(result?.has(cellKey(1, 1))).toBe(false);
  });

  it("forces the placement-move origin blocked (same-cell no-op)", () => {
    const a = course("A", "t1", ["s1"]);
    const context: DragHintContext = { members: [a], excludePlacementIds: ["p1"], origin: { day: 1, period: 1 } };
    const result = deriveDropHints(context, [placement("p1", "A", 1, 1)], catalog(a));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("excludes ALL of a bundle's placements so its members don't phantom-collide with their own twins", () => {
    // A bundle of A + B is dragged. Target (2,2) would otherwise read both as duplicates of the
    // source rows; excluding all source placements makes the destination judge only what remains.
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const context: DragHintContext = {
      members: [a, b],
      excludePlacementIds: ["p1", "p2"],
      origin: { day: 1, period: 1 },
    };
    const result = deriveDropHints(context, [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)], catalog(a, b));
    // The (empty after exclusion) target reads free; only the origin is forced blocked.
    expect(result?.has(cellKey(2, 2))).toBe(false);
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

describe("resolveDragHintContext", () => {
  it("resolves a course drag to a single member, no exclusion or origin", () => {
    const a = course("A", "t1", ["s1"]);
    const result = resolveDragHintContext(
      { kind: "course", courseId: "A" },
      { catalogById: catalog(a), groupings: [], placements: [] },
    );
    expect(result).toEqual({ members: [a] });
  });

  it("returns null for a course drag whose id is absent from the catalog", () => {
    const result = resolveDragHintContext(
      { kind: "course", courseId: "GHOST" },
      { catalogById: catalog(course("A", "t1", ["s1"])), groupings: [], placements: [] },
    );
    expect(result).toBeNull();
  });

  it("resolves a placement drag to its course, exclusion id, and origin cell", () => {
    const a = course("A", "t1", ["s1"]);
    const result = resolveDragHintContext(
      { kind: "placement", placementId: "p1", courseId: "A" },
      { catalogById: catalog(a), groupings: [], placements: [placement("p1", "A", 2, 3)] },
    );
    expect(result).toEqual({ members: [a], excludePlacementIds: ["p1"], origin: { day: 2, period: 3 } });
  });

  it("resolves a bundle drag to the source cell's occupants, all their ids, and the origin cell", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const result = resolveDragHintContext(
      { kind: "bundle", day: 2, period: 3 },
      {
        catalogById: catalog(a, b),
        groupings: [],
        // c sits in a different cell and must not be picked up.
        placements: [placement("p1", "A", 2, 3), placement("p2", "B", 2, 3), placement("p3", "C", 4, 4)],
      },
    );
    expect(result).toEqual({ members: [a, b], excludePlacementIds: ["p1", "p2"], origin: { day: 2, period: 3 } });
  });

  it("returns null for a bundle drag over an empty cell (no members resolve)", () => {
    const result = resolveDragHintContext(
      { kind: "bundle", day: 9, period: 9 },
      { catalogById: catalog(course("A", "t1", ["s1"])), groupings: [], placements: [placement("p1", "A", 1, 1)] },
    );
    expect(result).toBeNull();
  });

  it("returns null for a placement drag whose course is absent from the catalog", () => {
    const result = resolveDragHintContext(
      { kind: "placement", placementId: "p1", courseId: "GHOST" },
      { catalogById: catalog(course("A", "t1", ["s1"])), groupings: [], placements: [placement("p1", "GHOST", 1, 1)] },
    );
    expect(result).toBeNull();
  });

  it("resolves a grouping drag to all its catalog members", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const result = resolveDragHintContext(
      { kind: "grouping", groupingId: "g1" },
      { catalogById: catalog(a, b), groupings: [grouping("g1", ["A", "B"])], placements: [] },
    );
    expect(result).toEqual({ members: [a, b] });
  });

  it("returns null for an unknown grouping id (no members resolve)", () => {
    const result = resolveDragHintContext(
      { kind: "grouping", groupingId: "nope" },
      { catalogById: catalog(course("A", "t1", ["s1"])), groupings: [grouping("g1", ["A"])], placements: [] },
    );
    expect(result).toBeNull();
  });
});
