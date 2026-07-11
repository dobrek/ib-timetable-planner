import { cellKey } from "../collision/cell-key";

/** Count the distinct occupied `(day, period)` cells of one cohort's placement set —
 *  the diagnostics/benchmark slot metric (per cohort, never summed across cohorts). */
export const countOccupiedSlots = (placements: { day: number; period: number }[]): number =>
  new Set(placements.map((placement) => cellKey(placement.day, placement.period))).size;
