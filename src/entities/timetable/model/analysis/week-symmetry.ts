import { cellKey } from "../collision/cell-key";
import { lanesOf, type WeekLane } from "./lanes";
import type { AnalyzerRow, WeekSymmetryFeatures } from "./types";

/**
 * How alike the fortnight's two weeks are. Biweekly courses make A and B genuinely different
 * boards; the expert's paired CAS(a)/EE(b) cells are the extreme case — the same cell, a different
 * course each week. `differingCells` is the census of exactly that: cells whose course set is not
 * identical across the lanes.
 */
export const deriveWeekSymmetry = (rows: AnalyzerRow[]): WeekSymmetryFeatures => {
  const coursesByLaneCell = { a: coursesByCell(rows, "a"), b: coursesByCell(rows, "b") };
  const allCells = new Set([...coursesByLaneCell.a.keys(), ...coursesByLaneCell.b.keys()]);
  const slotsWeekA = coursesByLaneCell.a.size;
  const slotsWeekB = coursesByLaneCell.b.size;

  return {
    slotsWeekA,
    slotsWeekB,
    slotDelta: Math.abs(slotsWeekA - slotsWeekB),
    differingCells: [...allCells].filter(
      (cell) => !sameCourses(coursesByLaneCell.a.get(cell), coursesByLaneCell.b.get(cell)),
    ).length,
  };
};

const coursesByCell = (rows: AnalyzerRow[], lane: WeekLane): Map<string, Set<string>> => {
  const byCell = new Map<string, Set<string>>();
  for (const row of rows.filter((candidate) => lanesOf(candidate.week).includes(lane))) {
    const key = cellKey(row.day, row.period);
    const courses = byCell.get(key) ?? new Set<string>();
    courses.add(row.courseId);
    byCell.set(key, courses);
  }
  return byCell;
};

/** A cell used in only one lane is a differing cell — an absent lane is never "the same". */
const sameCourses = (a: Set<string> | undefined, b: Set<string> | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  return a.size === b.size && [...a].every((courseId) => b.has(courseId));
};
