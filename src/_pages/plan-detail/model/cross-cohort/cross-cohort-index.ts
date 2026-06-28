import type { PlacementWeek } from "@/shared/config";
import { cellKey } from "../collision/cell-key";

/**
 * One sibling-cohort teacher-occupancy cell as it arrives on the island (a JSON-serializable
 * board prop — `Map`/`Set` can't cross the server→island boundary). Each row is already
 * co-teacher-expanded server-side, so `teacherKey` is a single teacher occupied in the *other*
 * cohort at `(day, period)` on a given `week`. Distinct from `BoardAvailabilityCell`: this index
 * is **week-rich** (the cross-cohort rule is week-aware), where availability is week-agnostic.
 */
export type SiblingOccupancyCell = {
  teacherKey: string;
  day: number;
  period: number;
  week: PlacementWeek;
};

/**
 * Membership index the board derivations consume for the cross-cohort rule: teacherKey →
 * `cellKey` (`${day}:${period}`) → set of weeks that teacher is occupied in the *other* cohort.
 * Built once in the island from the raw cells, then handed to `deriveCellViolations` (via
 * `BoardContext.occupiedByTeacher`) and `deriveDropHints`.
 */
export type CrossCohortIndex = Map<string, Map<string, Set<PlacementWeek>>>;

export const EMPTY_CROSS_COHORT_INDEX: CrossCohortIndex = new Map();

export const buildCrossCohortIndex = (cells: SiblingOccupancyCell[]): CrossCohortIndex => {
  const index: CrossCohortIndex = new Map();
  for (const cell of cells) {
    const byCell = index.get(cell.teacherKey) ?? new Map<string, Set<PlacementWeek>>();
    if (!index.has(cell.teacherKey)) index.set(cell.teacherKey, byCell);
    const key = cellKey(cell.day, cell.period);
    const weeks = byCell.get(key) ?? new Set<PlacementWeek>();
    if (!byCell.has(key)) byCell.set(key, weeks);
    weeks.add(cell.week);
  }
  return index;
};

/**
 * Project an in-memory placement set into a co-teacher-expanded `SiblingOccupancyCell[]` — one row
 * per (teacher, cell, week). The board builds a *live* cross-cohort index from the other column's
 * current placements (not just the SSR snapshot), so it can re-validate one cohort against the
 * other's edits in the same render. A placement whose course is absent from `teacherKeysByCourseId`
 * is skipped — its teacher can't be attributed.
 */
export const projectFromPlacements = (
  placements: { courseId: string; day: number; period: number; week: PlacementWeek }[],
  teacherKeysByCourseId: Map<string, string[]>,
): SiblingOccupancyCell[] =>
  placements.flatMap((placement) => {
    const teacherKeys = teacherKeysByCourseId.get(placement.courseId);
    if (!teacherKeys) return []; // course not in the catalog — cannot attribute, skip
    return teacherKeys.map((teacherKey) => ({
      teacherKey,
      day: placement.day,
      period: placement.period,
      week: placement.week,
    }));
  });
