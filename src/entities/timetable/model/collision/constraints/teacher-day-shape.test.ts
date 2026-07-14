import { describe, expect, it } from "vitest";
import { catalog, course, dayCtx, occupiedBy, placement } from "../../__fixtures__/builders";
import { cellKey } from "../cell-key";
import { deriveCellViolations } from "../collisions";
import { exceedsTeacherDayShape, teacherDayShape } from "./teacher-day-shape";

/**
 * R2 — a teacher's working day spans at most 8 periods and holds at most 6 consecutive teaching
 * hours. Boundary-anchored on the gold board: it maxes out at exactly span 8 and a 6-run, so 8/6
 * must pass and 9/7 must fail.
 */
describe("teacherDayShape", () => {
  const c = course("C", "T", ["s"]);
  /** One course per period so a teacher's day can be built period by period. */
  const spread = (
    periods: number[],
    day = 1,
  ): { courses: (typeof c)[]; placements: ReturnType<typeof placement>[] } => {
    const courses = periods.map((period) => course(`C${period}`, "T", ["s"]));
    const placements = periods.map((period) => placement(`p${period}`, `C${period}`, day, period));
    return { courses, placements };
  };

  it("returns [] when the day index is absent (regression path)", () => {
    expect(teacherDayShape.explain([c], { cell: { day: 1, period: 1 }, catalogById: new Map() })).toEqual([]);
  });

  it("passes a day spanning exactly 8 periods with a 6-run (the gold board's own maximum)", () => {
    // P1-P6 taught (streak 6), free P7, P8 taught → span 8, maxStreak 6.
    const { courses, placements } = spread([1, 2, 3, 4, 5, 6, 8]);
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses });
    expect(teacherDayShape.explain([courses[0]], ctx)).toEqual([]);
  });

  it("flags a day spanning 9 periods", () => {
    const { courses, placements } = spread([1, 9]);
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses });
    expect(teacherDayShape.explain([courses[0]], ctx)).toEqual([
      { kind: "teacher-day-shape", teacherKey: "T", courseIds: ["C1"], span: 9, maxStreak: 1, lanes: ["a", "b"] },
    ]);
  });

  it("flags a 7th consecutive teaching hour even inside an 8-period span", () => {
    const { courses, placements } = spread([1, 2, 3, 4, 5, 6, 7]);
    const ctx = dayCtx({ cell: { day: 1, period: 4 }, placements, courses });
    expect(teacherDayShape.explain([courses[3]], ctx)).toEqual([
      { kind: "teacher-day-shape", teacherKey: "T", courseIds: ["C4"], span: 7, maxStreak: 7, lanes: ["a", "b"] },
    ]);
  });

  it("reads the teacher's WHOLE day — the sibling cohort's hours count toward the span", () => {
    // This cohort: P1 only. Sibling cohort: P9. The teacher's real day spans 9.
    const { courses, placements } = spread([1]);
    const ctx = dayCtx({
      cell: { day: 1, period: 1 },
      placements,
      courses,
      sibling: occupiedBy({ T: { [cellKey(1, 9)]: ["both"] } }),
    });
    expect(teacherDayShape.explain([courses[0]], ctx)).toEqual([
      { kind: "teacher-day-shape", teacherKey: "T", courseIds: ["C1"], span: 9, maxStreak: 1, lanes: ["a", "b"] },
    ]);
  });

  it("keeps week lanes separate — an A hour at P1 and a B hour at P9 are two different days", () => {
    const courses = [course("Ca", "T", ["s"]), course("Cb", "T", ["s"])];
    const placements = [placement("p1", "Ca", 1, 1, "a"), placement("p2", "Cb", 1, 9, "b")];
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, weeks: { Ca: "a" }, placements, courses });
    expect(teacherDayShape.explain([courses[0]], ctx)).toEqual([]);
  });

  it("does not span across days", () => {
    const courses = [course("C1", "T", ["s"]), course("C2", "T", ["s"])];
    const placements = [placement("p1", "C1", 1, 1), placement("p2", "C2", 2, 9)];
    const ctx = dayCtx({ cell: { day: 1, period: 1 }, placements, courses });
    expect(teacherDayShape.explain([courses[0]], ctx)).toEqual([]);
  });

  it("projects to a WARN (not blocking) severity through deriveCellViolations", () => {
    const { courses, placements } = spread([1, 9]);
    const cell = deriveCellViolations(placements, catalog(...courses)).get(cellKey(1, 1));
    expect(cell?.warningIds).toEqual(new Set(["C1"]));
    expect(cell?.blockingIds).toEqual(new Set());
  });
});

describe("exceedsTeacherDayShape", () => {
  it("is the rule the engine's fitsAt guard mirrors: span ≤ 8, streak ≤ 6", () => {
    expect(exceedsTeacherDayShape([])).toBe(false);
    expect(exceedsTeacherDayShape([1, 8])).toBe(false); // span 8 exactly
    expect(exceedsTeacherDayShape([1, 9])).toBe(true); // span 9
    expect(exceedsTeacherDayShape([1, 2, 3, 4, 5, 6])).toBe(false); // 6 in a row
    expect(exceedsTeacherDayShape([1, 2, 3, 4, 5, 6, 7])).toBe(true); // 7 in a row
    expect(exceedsTeacherDayShape([3, 4, 5, 6, 7, 8])).toBe(false);
  });
});
