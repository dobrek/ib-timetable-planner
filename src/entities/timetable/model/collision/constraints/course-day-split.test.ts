import { describe, expect, it } from "vitest";
import { catalog, course, dayCtx, placement } from "../../__fixtures__/builders";
import { cellKey } from "../cell-key";
import { deriveCellViolations } from "../collisions";
import { courseDaySplit, hasDaySplit } from "./course-day-split";

/**
 * R1 — a course's hours on one day must be consecutive, per concrete fortnightly week. The lunch
 * break is not special: P4+P5 across the break is a legal double, P2+P5 is a split.
 */
describe("courseDaySplit", () => {
  const c = course("C", "T", ["s"]);

  it("returns [] when the day index is absent (regression path)", () => {
    expect(courseDaySplit.explain([c], { cell: { day: 1, period: 1 }, catalogById: new Map() })).toEqual([]);
  });

  it("stays silent on a consecutive double", () => {
    const placements = [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2)];
    expect(courseDaySplit.explain([c], dayCtx({ cell: { day: 1, period: 1 }, placements, courses: [c] }))).toEqual([]);
  });

  it("stays silent on a double that straddles the lunch break — a break is not a split", () => {
    const placements = [placement("p1", "C", 1, 5), placement("p2", "C", 1, 6)];
    expect(courseDaySplit.explain([c], dayCtx({ cell: { day: 1, period: 5 }, placements, courses: [c] }))).toEqual([]);
  });

  it("flags a gapped same-day pair, carrying the offending periods (every cell of the day agrees)", () => {
    const placements = [placement("p1", "C", 1, 2), placement("p2", "C", 1, 5)];
    const expected = [{ kind: "course-day-split", courseIds: ["C"], periods: [2, 5], lanes: ["a", "b"] }];
    expect(courseDaySplit.explain([c], dayCtx({ cell: { day: 1, period: 2 }, placements, courses: [c] }))).toEqual(
      expected,
    );
    expect(courseDaySplit.explain([c], dayCtx({ cell: { day: 1, period: 5 }, placements, courses: [c] }))).toEqual(
      expected,
    );
  });

  it("counts week lanes separately — an A hour at P2 and a B hour at P5 are two days, not a split", () => {
    const placements = [placement("p1", "C", 1, 2, "a"), placement("p2", "C", 1, 5, "b")];
    const aCell = dayCtx({ cell: { day: 1, period: 2 }, weeks: { C: "a" }, placements, courses: [c] });
    const bCell = dayCtx({ cell: { day: 1, period: 5 }, weeks: { C: "b" }, placements, courses: [c] });
    expect(courseDaySplit.explain([c], aCell)).toEqual([]);
    expect(courseDaySplit.explain([c], bCell)).toEqual([]);
  });

  it("flags the lane a `both` hour splits — both + a at a distance breaks week A only", () => {
    const placements = [placement("p1", "C", 1, 2, "both"), placement("p2", "C", 1, 5, "a")];
    const aCell = dayCtx({ cell: { day: 1, period: 5 }, weeks: { C: "a" }, placements, courses: [c] });
    expect(courseDaySplit.explain([c], aCell)).toEqual([
      { kind: "course-day-split", courseIds: ["C"], periods: [2, 5], lanes: ["a"] },
    ]);
  });

  it("does not split across different days", () => {
    const placements = [placement("p1", "C", 1, 2), placement("p2", "C", 2, 5)];
    expect(courseDaySplit.explain([c], dayCtx({ cell: { day: 1, period: 2 }, placements, courses: [c] }))).toEqual([]);
  });

  it("projects to a WARN (not blocking) severity through deriveCellViolations", () => {
    const placements = [placement("p1", "C", 1, 2), placement("p2", "C", 1, 5)];
    const cell = deriveCellViolations(placements, catalog(c)).get(cellKey(1, 2));
    expect(cell?.warningIds).toEqual(new Set(["C"]));
    expect(cell?.blockingIds).toEqual(new Set());
  });
});

describe("hasDaySplit", () => {
  it("is the rule the engine's fitsAt guard mirrors", () => {
    expect(hasDaySplit([])).toBe(false);
    expect(hasDaySplit([3])).toBe(false);
    expect(hasDaySplit([3, 4])).toBe(false);
    expect(hasDaySplit([4, 3])).toBe(false); // order-free
    expect(hasDaySplit([3, 5])).toBe(true);
    expect(hasDaySplit([3, 4, 5])).toBe(false);
    expect(hasDaySplit([3, 4, 6])).toBe(true);
  });
});
