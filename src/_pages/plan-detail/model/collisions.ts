import type { GroupingCourse } from "./grouping";
import { hasIntersection } from "./collision";
import type { PlannerPlacement } from "./placement";

/** Canonical `(day, period)` cell identity, shared by the grid, droppables, and the collision map. */
export const cellKey = (day: number, period: number): string => `${day}:${period}`;

/**
 * Per-cell collision attribution, derived from current placement state and the
 * validation catalog. For each multi-occupancy cell, every occupant course is checked
 * against the others via {@link hasIntersection} (shared students or shared teacher,
 * within the cohort); the ids of all participants in a collision are collected.
 *
 * Returns `Map<cellKey, Set<conflictingCourseId>>`. Pure and O(occupants²) per cell —
 * recompute on every add/move/remove so a flag auto-clears when a participant leaves.
 */
export const deriveCollisions = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, Set<string>> => {
  const occupantsByCell = new Map<string, GroupingCourse[]>();
  for (const placement of placements) {
    const course = catalogById.get(placement.courseId);
    if (!course) continue; // not in the validation catalog — cannot judge, skip defensively
    const key = cellKey(placement.day, placement.period);
    const list = occupantsByCell.get(key);
    if (list) list.push(course);
    else occupantsByCell.set(key, [course]);
  }

  const collisions = new Map<string, Set<string>>();
  for (const [key, occupants] of occupantsByCell) {
    if (occupants.length < 2) continue;
    const conflicting = new Set<string>();
    for (let i = 0; i < occupants.length; i++) {
      const others = occupants.filter((_, index) => index !== i);
      if (hasIntersection(occupants[i], others)) conflicting.add(occupants[i].id);
    }
    if (conflicting.size > 0) collisions.set(key, conflicting);
  }
  return collisions;
};
