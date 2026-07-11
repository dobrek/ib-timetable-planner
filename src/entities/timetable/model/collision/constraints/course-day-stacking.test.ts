import { describe, expect, it } from "vitest";
import { catalog, course, dayCtx, placement } from "../../__fixtures__/builders";
import { cellKey } from "../cell-key";
import { deriveCellViolations } from "../collisions";
import { courseDayStacking } from "./course-day-stacking";

/**
 * Matrix for the warn-level daily spread cap (Critical Implementation Details): ≥3 same-day
 * periods of one course in a concrete week warns; ≤2 stays silent; `both` counts in each week.
 */
describe("courseDayStacking", () => {
  const c = course("C", "T", ["s"]);

  it("returns [] when the day index is absent (regression path)", () => {
    expect(courseDayStacking.explain([c], { cell: { day: 1, period: 1 }, catalogById: new Map() })).toEqual([]);
  });

  it("stays silent at 2 same-day periods (a legal double)", () => {
    const placements = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2)];
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], ctx)).toEqual([]);
  });

  it("warns at 3 same-day periods, with the stack size as the count", () => {
    const placements = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2), placement("p3", "C", 1, 3)];
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], ctx)).toEqual([{ kind: "course-day-stacking", courseIds: ["C"], count: 3 }]);
  });

  it("counts per concrete week — a `both`+`both`+`a` day stacks week A (all three cells warn)", () => {
    const placements = [
      placement("p1", "C", 1, 1, "both"),
      placement("p2", "C", 1, 2, "both"),
      placement("p3", "C", 1, 3, "a"),
    ];
    const bothCell = dayCtx({ cell: { day: 1, period: 1 }, weeks: { C: "both" }, placements, courses: [c] });
    const aCell = dayCtx({ cell: { day: 1, period: 3 }, weeks: { C: "a" }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], bothCell)).toEqual([
      { kind: "course-day-stacking", courseIds: ["C"], count: 3 },
    ]);
    expect(courseDayStacking.explain([c], aCell)).toEqual([
      { kind: "course-day-stacking", courseIds: ["C"], count: 3 },
    ]);
  });

  it("stays silent when no concrete week reaches 3 (a, a, b → week A has 2, week B has 1)", () => {
    const placements = [
      placement("p1", "C", 1, 1, "a"),
      placement("p2", "C", 1, 2, "a"),
      placement("p3", "C", 1, 3, "b"),
    ];
    const aCell = dayCtx({ cell: { day: 1, period: 1 }, weeks: { C: "a" }, placements, courses: [c] });
    const bCell = dayCtx({ cell: { day: 1, period: 3 }, weeks: { C: "b" }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], aCell)).toEqual([]);
    expect(courseDayStacking.explain([c], bCell)).toEqual([]);
  });

  it("warns only the cells whose concrete week stacks (both,a,a,b → the lone B cell stays silent)", () => {
    // week A = both + a + a = 3 (stacks); week B = both + b = 2 (silent).
    const placements = [
      placement("p1", "C", 1, 1, "both"),
      placement("p2", "C", 1, 2, "a"),
      placement("p3", "C", 1, 3, "a"),
      placement("p4", "C", 1, 4, "b"),
    ];
    const aCell = dayCtx({ cell: { day: 1, period: 2 }, weeks: { C: "a" }, placements, courses: [c] });
    const bCell = dayCtx({ cell: { day: 1, period: 4 }, weeks: { C: "b" }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], aCell)).toEqual([
      { kind: "course-day-stacking", courseIds: ["C"], count: 3 },
    ]);
    expect(courseDayStacking.explain([c], bCell)).toEqual([]);
  });

  it("does not stack across different days", () => {
    const placements = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2), placement("p3", "C", 2, 1)];
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses: [c] });
    expect(courseDayStacking.explain([c], ctx)).toEqual([]);
  });

  it("projects to a WARN (not blocking) severity through deriveCellViolations", () => {
    const catalogById = catalog(c);
    const placements = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2), placement("p3", "C", 1, 3)];
    const result = deriveCellViolations(placements, catalogById);
    const cell = result.get(cellKey(1, 1));
    expect(cell?.warningIds).toEqual(new Set(["C"]));
    expect(cell?.blockingIds).toEqual(new Set());
  });
});
