import { groupBy } from "@/shared/lib/collections";
import { cellKey } from "./cell-key";
import { type CellCollisions } from "./collisions";
import { resolveCourseDisplay, type CourseDisplay } from "../course-display";
import type { LocalPlacement } from "../placement/placement";

/**
 * A per-cell occupant view-model: the placement identity token plus its display name and
 * collision flags, all resolved once at grouping time. The cell/chip components receive this
 * instead of the global `courseDisplay` map and a `CellCollisions` record, so name + flag resolution
 * happens once per occupant rather than inside every chip's render. Identity (`placement`) is
 * kept separate from resolved display per the "identity as opaque tokens" lesson.
 */
export type CellOccupant = {
  placement: LocalPlacement;
  name: string;
  blocking: boolean;
  warning: boolean;
  unavailable: boolean;
};

/**
 * Group placements into their `(day, period)` cells, resolving each occupant's display name and
 * collision flags from `courseDisplay` + the cell's `CellCollisions` (absent → all-`false`). Each
 * cell's occupants are sorted by display name, then `courseId`, so chip order is stable across reloads
 * — the DB read has no inherent ordering. Replaces the in-component `groupByCell`/`compareByName`.
 */
export const groupCellOccupants = (
  placements: LocalPlacement[],
  courseDisplay: Record<string, CourseDisplay>,
  collisions: Map<string, CellCollisions>,
): Map<string, CellOccupant[]> => {
  const byCell = groupBy(placements, (placement) => cellKey(placement.day, placement.period));
  const result = new Map<string, CellOccupant[]>();
  for (const [key, cellPlacements] of byCell) {
    const cellCollisions = collisions.get(key);
    const occupants = cellPlacements.map((placement) => toOccupant(placement, courseDisplay, cellCollisions));
    occupants.sort(compareByName);
    result.set(key, occupants);
  }
  return result;
};

const toOccupant = (
  placement: LocalPlacement,
  courseDisplay: Record<string, CourseDisplay>,
  collisions: CellCollisions | undefined,
): CellOccupant => ({
  placement,
  name: resolveCourseDisplay(courseDisplay, placement.courseId).name,
  blocking: collisions?.blockingIds.has(placement.courseId) ?? false,
  warning: collisions?.warningIds.has(placement.courseId) ?? false,
  unavailable: collisions?.unavailableIds.has(placement.courseId) ?? false,
});

const compareByName = (a: CellOccupant, b: CellOccupant): number => {
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName : a.placement.courseId.localeCompare(b.placement.courseId);
};
