import { describe, expect, it } from "vitest";
import { catalog, course, dayCtx, placement } from "../../__fixtures__/builders";
import { cellKey } from "../cell-key";
import { deriveCellViolations } from "../collisions";
import { earlyFinishEdge } from "./early-finish-edge";

/**
 * Semantics matrix for the blocking early-finish edge rule (Critical Implementation Details).
 * Each case evaluates the flagged course at the cell it occupies against the whole-day index.
 */
describe("earlyFinishEdge", () => {
  it("returns [] when the flag set / day index are absent (regression path)", () => {
    const f = course("F", "T", ["s"]);
    expect(earlyFinishEdge.explain([f], { cell: { day: 1, period: 3 }, catalogById: new Map() })).toEqual([]);
  });

  it("does not flag when the student has no OTHER periods that day (O empty)", () => {
    const f = course("F", "T", ["s"]);
    const ctx = dayCtx({
      cell: { day: 1, period: 3 },
      flagged: ["F"],
      placements: [placement("pf", "F", 1, 3)],
      courses: [f],
    });
    expect(earlyFinishEdge.explain([f], ctx)).toEqual([]);
  });

  it("does not flag an unflagged interior course", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const ctx = dayCtx({
      cell: { day: 1, period: 3 },
      // F not in `flagged`.
      flagged: [],
      placements: [placement("pf", "F", 1, 3), placement("px", "X", 1, 1), placement("py", "Y", 1, 5)],
      courses: [f, x, y],
    });
    expect(earlyFinishEdge.explain([f], ctx)).toEqual([]);
  });

  it("blocks an interior placement (period strictly between the student's other periods)", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const ctx = dayCtx({
      cell: { day: 1, period: 3 },
      flagged: ["F"],
      placements: [placement("pf", "F", 1, 3), placement("px", "X", 1, 1), placement("py", "Y", 1, 5)],
      courses: [f, x, y],
    });
    expect(earlyFinishEdge.explain([f], ctx)).toEqual([
      { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s"] },
    ]);
  });

  it("allows an edge double — F at 1–2 before others at 3–5 self-violates neither cell", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const placements = [
      placement("pf1", "F", 1, 1),
      placement("pf2", "F", 1, 2),
      placement("px", "X", 1, 3),
      placement("py", "Y", 1, 5),
    ];
    const at = (period: number) => dayCtx({ cell: { day: 1, period }, flagged: ["F"], placements, courses: [f, x, y] });
    expect(earlyFinishEdge.explain([f], at(1))).toEqual([]);
    expect(earlyFinishEdge.explain([f], at(2))).toEqual([]);
  });

  it("allows a suffix edge double — F at 4–5 after others at 1–3", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const placements = [
      placement("px", "X", 1, 1),
      placement("py", "X", 1, 3),
      placement("pf1", "F", 1, 4),
      placement("pf2", "F", 1, 5),
    ];
    const at = (period: number) => dayCtx({ cell: { day: 1, period }, flagged: ["F"], placements, courses: [f, x] });
    expect(earlyFinishEdge.explain([f], at(4))).toEqual([]);
    expect(earlyFinishEdge.explain([f], at(5))).toEqual([]);
  });

  it("blocks an interior double — both F cells sit between the student's other periods", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const placements = [
      placement("px", "X", 1, 1),
      placement("pf2", "F", 1, 2),
      placement("pf3", "F", 1, 3),
      placement("py", "Y", 1, 5),
    ];
    const at = (period: number) => dayCtx({ cell: { day: 1, period }, flagged: ["F"], placements, courses: [f, x, y] });
    expect(earlyFinishEdge.explain([f], at(2))).toEqual([
      { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s"] },
    ]);
    expect(earlyFinishEdge.explain([f], at(3))).toEqual([
      { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s"] },
    ]);
  });

  describe("week interplay", () => {
    it("ignores opposite-week neighbours (disjoint weeks do not count toward O)", () => {
      const f = course("F", "T", ["s"]);
      const x = course("X", "T", ["s"]);
      const y = course("Y", "T", ["s"]);
      const ctx = dayCtx({
        cell: { day: 1, period: 3 },
        weeks: { F: "a" },
        flagged: ["F"],
        placements: [placement("pf", "F", 1, 3, "a"), placement("px", "X", 1, 1, "b"), placement("py", "Y", 1, 5, "b")],
        courses: [f, x, y],
      });
      expect(earlyFinishEdge.explain([f], ctx)).toEqual([]);
    });

    it("counts same-week and agnostic neighbours (a `both` neighbour overlaps week a)", () => {
      const f = course("F", "T", ["s"]);
      const x = course("X", "T", ["s"]);
      const y = course("Y", "T", ["s"]);
      const ctx = dayCtx({
        cell: { day: 1, period: 3 },
        weeks: { F: "a" },
        flagged: ["F"],
        placements: [
          placement("pf", "F", 1, 3, "a"),
          placement("px", "X", 1, 1, "a"),
          placement("py", "Y", 1, 5, "both"),
        ],
        courses: [f, x, y],
      });
      expect(earlyFinishEdge.explain([f], ctx)).toEqual([
        { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s"] },
      ]);
    });

    it("allows a `both` flagged placement between an A neighbour and a B neighbour (lane-wise, not union)", () => {
      // The student never lives a day holding both X and Y: in week A the day is X@1, F@3 (F last);
      // in week B it is F@3, Y@5 (F first). F is at an edge of every REAL day, so when it stops
      // running mid-year no hole appears — the union of the two weeks invents a box that cannot
      // occur. The engine's `fitsAt` guard reads lanes separately for the same reason, and an
      // over-strict oracle here would reject boards the search legitimately constructs (a
      // fitsAt-looser-than-verify gap with no in-loop signal — caught by the engine fuzz).
      const f = course("F", "T", ["s"]);
      const x = course("X", "T", ["s"]);
      const y = course("Y", "T", ["s"]);
      const ctx = dayCtx({
        cell: { day: 1, period: 3 },
        weeks: { F: "both" },
        flagged: ["F"],
        placements: [
          placement("pf", "F", 1, 3, "both"),
          placement("px", "X", 1, 1, "a"),
          placement("py", "Y", 1, 5, "b"),
        ],
        courses: [f, x, y],
      });
      expect(earlyFinishEdge.explain([f], ctx)).toEqual([]);
    });

    it("blocks a `both` flagged placement boxed WITHIN one week lane", () => {
      const f = course("F", "T", ["s"]);
      const x = course("X", "T", ["s"]);
      const y = course("Y", "T", ["s"]);
      const ctx = dayCtx({
        cell: { day: 1, period: 3 },
        weeks: { F: "both" },
        flagged: ["F"],
        placements: [
          placement("pf", "F", 1, 3, "both"),
          placement("px", "X", 1, 1, "a"),
          placement("py", "Y", 1, 5, "a"),
        ],
        courses: [f, x, y],
      });
      expect(earlyFinishEdge.explain([f], ctx)).toEqual([
        { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s"] },
      ]);
    });
  });

  it("blames only the interior students (multi-student)", () => {
    const f = course("F", "T", ["s1", "s2"]);
    const x = course("X", "T", ["s1"]);
    const y = course("Y", "T", ["s1"]);
    const z = course("Z", "T", ["s2"]); // s2's only other period, at 5 → edge, not interior
    const ctx = dayCtx({
      cell: { day: 1, period: 3 },
      flagged: ["F"],
      placements: [
        placement("pf", "F", 1, 3),
        placement("px", "X", 1, 1),
        placement("py", "Y", 1, 5),
        placement("pz", "Z", 1, 5),
      ],
      courses: [f, x, y, z],
    });
    expect(earlyFinishEdge.explain([f], ctx)).toEqual([
      { kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s1"] },
    ]);
  });

  it("treats a second flagged course as an OTHER period when judging the first (multi-flagged)", () => {
    const f1 = course("F1", "T", ["s"]);
    const f2 = course("F2", "T", ["s"]);
    const placements = [placement("pf1", "F1", 1, 3), placement("pf2a", "F2", 1, 1), placement("pf2b", "F2", 1, 5)];
    // F1 interior between F2's two periods → blocked.
    const f1Ctx = dayCtx({ cell: { day: 1, period: 3 }, flagged: ["F1", "F2"], placements, courses: [f1, f2] });
    expect(earlyFinishEdge.explain([f1], f1Ctx)).toEqual([
      { kind: "early-finish-edge", courseIds: ["F1"], studentKeys: ["s"] },
    ]);
    // F2 at 1 and 5 are the edges around F1 at 3 → neither F2 cell is interior.
    const f2First = dayCtx({ cell: { day: 1, period: 1 }, flagged: ["F1", "F2"], placements, courses: [f1, f2] });
    const f2Last = dayCtx({ cell: { day: 1, period: 5 }, flagged: ["F1", "F2"], placements, courses: [f1, f2] });
    expect(earlyFinishEdge.explain([f2], f2First)).toEqual([]);
    expect(earlyFinishEdge.explain([f2], f2Last)).toEqual([]);
  });

  it("projects to a BLOCKING severity through deriveCellViolations (flag set delivered)", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const catalogById = catalog(f, x, y);
    const placements = [placement("pf", "F", 1, 3), placement("px", "X", 1, 1), placement("py", "Y", 1, 5)];
    const result = deriveCellViolations(placements, catalogById, undefined, undefined, new Set(["F"]));
    const cell = result.get(cellKey(1, 3));
    expect(cell?.blockingIds).toEqual(new Set(["F"]));
    expect(cell?.warningIds).toEqual(new Set());
  });

  it("stays dormant through deriveCellViolations when the flag set is empty (pre-delivery)", () => {
    const f = course("F", "T", ["s"]);
    const x = course("X", "T", ["s"]);
    const y = course("Y", "T", ["s"]);
    const catalogById = catalog(f, x, y);
    const placements = [placement("pf", "F", 1, 3), placement("px", "X", 1, 1), placement("py", "Y", 1, 5)];
    // No flag set → the edge rule finds no flagged course; the cell has no other violation.
    expect(deriveCellViolations(placements, catalogById).get(cellKey(1, 3))).toBeUndefined();
  });
});
