import { cellKey } from "../collision/cell-key";
import { distribution } from "./stats";
import type { AnalyzerRow, DailyLoadFeatures } from "./types";

/**
 * How evenly one cohort's week carries its load. Two readings, because they answer different
 * questions: `hours` counts placement rows (what a cohort's students collectively sit through),
 * `slots` counts distinct occupied cells (what the grid spends). A day packed with wide bundles
 * has many hours in few slots.
 *
 * Reported as distributions across days — the totals are catalog constants on a complete board.
 */
export const deriveDailyLoad = (rows: AnalyzerRow[], days: number): DailyLoadFeatures => {
  const hoursPerDay = perDay(days, (day) => rows.filter((row) => row.day === day).length);
  const slotsPerDay = perDay(
    days,
    (day) => new Set(rows.filter((row) => row.day === day).map((row) => cellKey(row.day, row.period))).size,
  );
  return {
    hoursPerDay,
    slotsPerDay,
    hours: distribution(hoursPerDay),
    slots: distribution(slotsPerDay),
  };
};

const perDay = (days: number, countOf: (day: number) => number): number[] =>
  Array.from({ length: days }, (_, index) => countOf(index + 1));
