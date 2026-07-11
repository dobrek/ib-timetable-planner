import { describe, expect, it } from "vitest";
import type { WeekMode } from "@/shared/config";
import { cellKey, type PlannerPlacement } from "@/entities/timetable";
import { deriveDropHints, resolveDragHintContext, type DragHintContext } from "./drop-hints";
import type { GroupingCourse, PlannerGrouping } from "./grouping/grouping";

const course = (
  id: string,
  teacher: string | null,
  studentKeys: string[],
  weekMode: WeekMode = "agnostic",
): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  studentKeys,
  hours: 4,
  weekMode,
});

const placement = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
});

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({
  id,
  memberIds,
  coverageCount: 1,
  score: 1,
  oppositeWeek: false,
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

  it("blocks an EMPTY cell where the dragged course's teacher is strong-unavailable", () => {
    const a = course("A", "t1", ["s1"]);
    const result = deriveDropHints({ members: [a] }, [], catalog(a), availability({ t1: [cellKey(1, 1)] }));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
    // Cells where the teacher is available stay free.
    expect(result?.has(cellKey(2, 2))).toBe(false);
  });

  it("marks a group cell partial when one member's teacher is strong-unavailable there but the other fits", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const result = deriveDropHints({ members: [a, b] }, [], catalog(a, b), availability({ t1: [cellKey(1, 1)] }));
    expect(result?.get(cellKey(1, 1))).toBe("partial");
  });

  it("hints warn on an otherwise-free cell where the dragged course's teacher is soft-unavailable", () => {
    const a = course("A", "t1", ["s1"]);
    const result = deriveDropHints({ members: [a] }, [], catalog(a), availability({}, { t1: [cellKey(1, 1)] }));
    expect(result?.get(cellKey(1, 1))).toBe("warn");
    expect(result?.has(cellKey(2, 2))).toBe(false);
  });

  it("blocked dominates warn (precedence) when a cell is both strong- and soft-unavailable", () => {
    const a = course("A", "t1", ["s1"]);
    const result = deriveDropHints(
      { members: [a] },
      [],
      catalog(a),
      availability({ t1: [cellKey(1, 1)] }, { t1: [cellKey(1, 1)] }),
    );
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("a collision blocked dominates a soft-unavailable warn on the same cell", () => {
    // B occupies (1,1) sharing teacher t1 with A → collision; A also soft-unavailable there.
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t1", ["s2"]);
    const result = deriveDropHints(
      { members: [a] },
      [placement("p1", "B", 1, 1)],
      catalog(a, b),
      availability({}, { t1: [cellKey(1, 1)] }),
    );
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });
});

// Build an AvailabilityIndex from teacherKey → cellKey[] for each severity.
const toMap = (rec: Record<string, string[]>) =>
  new Map(Object.entries(rec).map(([teacher, keys]) => [teacher, new Set(keys)]));
const availability = (strong: Record<string, string[]>, soft: Record<string, string[]> = {}) => ({
  strongUnavailableByTeacher: toMap(strong),
  softUnavailableByTeacher: toMap(soft),
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
      { kind: "placement", placementId: "p1", courseId: "A", cohort: "dp1" },
      { catalogById: catalog(a), groupings: [], placements: [placement("p1", "A", 2, 3)] },
    );
    expect(result).toEqual({ members: [a], excludePlacementIds: ["p1"], origin: { day: 2, period: 3 } });
  });

  it("resolves a bundle drag to the source cell's occupants, all their ids, and the origin cell", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const result = resolveDragHintContext(
      { kind: "bundle", day: 2, period: 3, cohort: "dp1" },
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
      { kind: "bundle", day: 9, period: 9, cohort: "dp1" },
      { catalogById: catalog(course("A", "t1", ["s1"])), groupings: [], placements: [placement("p1", "A", 1, 1)] },
    );
    expect(result).toBeNull();
  });

  it("returns null for a placement drag whose course is absent from the catalog", () => {
    const result = resolveDragHintContext(
      { kind: "placement", placementId: "p1", courseId: "GHOST", cohort: "dp1" },
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

describe("deriveDropHints — opposite-week (soft edge)", () => {
  it("marks a soft-conflicting cell opposite-week, not blocked, for a bi-weekly drag over a bi-weekly occupant", () => {
    const dragged = course("A", "t1", ["s1"], "biweekly");
    const occupant = course("B", "t1", ["s2"], "biweekly"); // shares teacher t1 → conflict, both biweekly → soft
    const result = deriveDropHints({ members: [dragged] }, [placement("p1", "B", 1, 1)], catalog(dragged, occupant));
    expect(result?.get(cellKey(1, 1))).toBe("opposite-week");
  });

  it("still blocks when the dragged course is agnostic (hard edge)", () => {
    const dragged = course("A", "t1", ["s1"], "agnostic");
    const occupant = course("B", "t1", ["s2"], "biweekly");
    const result = deriveDropHints({ members: [dragged] }, [placement("p1", "B", 1, 1)], catalog(dragged, occupant));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("still blocks when a conflicting occupant is agnostic (hard edge), even if the dragged course is bi-weekly", () => {
    const dragged = course("A", "t1", ["s1"], "biweekly");
    const occupant = course("B", "t1", ["s2"], "agnostic");
    const result = deriveDropHints({ members: [dragged] }, [placement("p1", "B", 1, 1)], catalog(dragged, occupant));
    expect(result?.get(cellKey(1, 1))).toBe("blocked");
  });

  it("leaves a non-conflicting cell free even when both courses are bi-weekly", () => {
    const dragged = course("A", "t1", ["s1"], "biweekly");
    const occupant = course("C", "t2", ["s9"], "biweekly"); // disjoint teacher + students → no conflict
    const result = deriveDropHints({ members: [dragged] }, [placement("p1", "C", 1, 1)], catalog(dragged, occupant));
    expect(result?.has(cellKey(1, 1))).toBe(false);
  });
});

describe("deriveDropHints — day-scoped rules", () => {
  // A flagged course F (student s) plus that student's other courses at the day's edges (periods 1
  // and 5). Distinct teachers so only the day-scoped axis, not a teacher clash, drives the verdict.
  const f = course("F", "tf", ["s"]);
  const x = course("X", "tx", ["s"]);
  const y = course("Y", "ty", ["s"]);
  const dayEdges = [placement("px", "X", 1, 1), placement("py", "Y", 1, 5)];
  const FLAGGED = new Set(["F"]);

  describe("early-finish edge", () => {
    it("blocks an empty interior cell while dragging a flagged course", () => {
      const result = deriveDropHints({ members: [f] }, dayEdges, catalog(f, x, y), undefined, undefined, FLAGGED);
      // (1,3) is empty and strictly between the student's edges (1 and 5) → blocked.
      expect(result?.get(cellKey(1, 3))).toBe("blocked");
    });

    it("leaves an edge / off-day cell free while dragging a flagged course", () => {
      const result = deriveDropHints({ members: [f] }, dayEdges, catalog(f, x, y), undefined, undefined, FLAGGED);
      expect(result?.get(cellKey(1, 6))).toBeUndefined(); // period 6 > max edge (5) → not interior
      expect(result?.get(cellKey(2, 3))).toBeUndefined(); // day 2 — student has no periods there
    });

    it("does not block interior cells for an UNflagged dragged course", () => {
      const result = deriveDropHints({ members: [x] }, dayEdges, catalog(f, x, y), undefined, undefined, new Set());
      expect(result?.get(cellKey(1, 3))).toBeUndefined();
    });

    it("excludes the drag origin from the what-if on a move", () => {
      // F sits interior at (1,3); moving it should still see the student's edges (1,5) as OTHER
      // periods, so a different interior cell stays blocked and the origin is forced blocked.
      const placements = [...dayEdges, placement("pf", "F", 1, 3)];
      const context = { members: [f], excludePlacementIds: ["pf"], origin: { day: 1, period: 3 } };
      const result = deriveDropHints(context, placements, catalog(f, x, y), undefined, undefined, FLAGGED);
      expect(result?.get(cellKey(1, 2))).toBe("blocked"); // still interior
      expect(result?.get(cellKey(1, 3))).toBe("blocked"); // origin no-op
    });
  });

  describe("early-finish edge — week-aware bi-weekly escape", () => {
    // A week-A placement of X/Y at the day edges: a bi-weekly flagged course can dodge by taking
    // week B (the drop week is chosen after the drop), so the interior cell is a legal opposite-week
    // drop, not a hard block — mirroring `crossCohortFit`.
    const fBi = course("F", "tf", ["s"], "biweekly");
    const weekA = (id: string, courseId: string, period: number): PlannerPlacement => ({
      id,
      courseId,
      day: 1,
      period,
      week: "a",
      isOptional: false,
    });
    const edgesWeekA = [weekA("px", "X", 1), weekA("py", "Y", 5)];

    it("marks an interior cell opposite-week (not blocked) when a flagged bi-weekly course is interior on only one week", () => {
      const result = deriveDropHints({ members: [fBi] }, edgesWeekA, catalog(fBi, x, y), undefined, undefined, FLAGGED);
      // Interior on week A only → F on week B dodges → opposite-week, not blocked.
      expect(result?.get(cellKey(1, 3))).toBe("opposite-week");
    });

    it("still blocks a flagged bi-weekly course interior on BOTH weeks (agnostic neighbors run every week)", () => {
      // dayEdges' X/Y are agnostic (`both`), so neither week dodges them → hard block stands.
      const result = deriveDropHints({ members: [fBi] }, dayEdges, catalog(fBi, x, y), undefined, undefined, FLAGGED);
      expect(result?.get(cellKey(1, 3))).toBe("blocked");
    });
  });

  describe("same-day stacking", () => {
    const c = course("C", "tc", ["s"]);
    const twoOnDay1 = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2)];

    it("warns an empty same-day cell that would be the course's 3rd period (grid supplied)", () => {
      const result = deriveDropHints({ members: [c] }, twoOnDay1, catalog(c), undefined, undefined, new Set(), {
        periods: 6,
      });
      expect(result?.get(cellKey(1, 4))).toBe("warn");
    });

    it("does not seed empty stacking cells without the grid (perf/parity degrade)", () => {
      const result = deriveDropHints({ members: [c] }, twoOnDay1, catalog(c));
      expect(result?.get(cellKey(1, 4))).toBeUndefined();
    });

    it("stays silent when only a legal double would result (origin excluded on move)", () => {
      // Moving one of the two C placements within the day yields 2 total, not 3 → no warn.
      const context = { members: [c], excludePlacementIds: ["p2"], origin: { day: 1, period: 2 } };
      const result = deriveDropHints(context, twoOnDay1, catalog(c), undefined, undefined, new Set(), { periods: 6 });
      expect(result?.get(cellKey(1, 4))).toBeUndefined();
    });
  });
});
