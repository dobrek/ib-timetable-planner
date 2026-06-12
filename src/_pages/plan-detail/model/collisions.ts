import type { CollisionViolation } from "./constraints";
import { explainCell } from "./constraints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

/** Canonical `(day, period)` cell identity, shared by the grid, droppables, and the collision map. */
export const cellKey = (day: number, period: number): string => `${day}:${period}`;

export type CellCollisions = {
  /** Projection: every course id participating in a violation — drives the grid flags. */
  conflictingIds: Set<string>;
  /** Structured explanations for the cell, in registry order — drives the detail Dialog. */
  violations: CollisionViolation[];
};

/**
 * Per-cell collision derivation from current placement state and the validation
 * catalog. For each multi-occupancy cell, the constraint registry enumerates every
 * violation among the occupants; `conflictingIds` is the union of course ids across
 * those violations (same semantics the grid flagged before violations existed).
 *
 * Pure and O(occupants²) per cell over tiny N — recompute on every add/move/remove
 * so a flag auto-clears when a participant leaves.
 */
export const deriveCellViolations = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, CellCollisions> => {
  const cells = bucketByCell(placements, catalogById);

  const collisions = new Map<string, CellCollisions>();
  for (const [key, { cell, occupants }] of cells) {
    if (occupants.length < 2) continue;
    const violations = explainCell(occupants, { cell, catalogById });
    if (violations.length > 0) collisions.set(key, { conflictingIds: collectCourseIds(violations), violations });
  }
  return collisions;
};

const bucketByCell = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, { cell: { day: number; period: number }; occupants: GroupingCourse[] }> => {
  const cells = new Map<string, { cell: { day: number; period: number }; occupants: GroupingCourse[] }>();
  for (const placement of placements) {
    const course = catalogById.get(placement.courseId);
    if (!course) continue; // not in the validation catalog — cannot judge, skip defensively
    const key = cellKey(placement.day, placement.period);
    const entry = cells.get(key);
    if (entry) entry.occupants.push(course);
    else cells.set(key, { cell: { day: placement.day, period: placement.period }, occupants: [course] });
  }
  return cells;
};

const collectCourseIds = (violations: CollisionViolation[]): Set<string> => {
  const ids = new Set<string>();
  for (const violation of violations) {
    if (violation.kind === "duplicate-course") ids.add(violation.courseId);
    else for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};
