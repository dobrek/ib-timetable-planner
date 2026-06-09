import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

/** Placed-vs-required hours for one course. */
export type HoursStat = { placed: number; required: number };

/**
 * Placed-vs-required hours per course, derived from current placement state and the
 * catalog. `placed` is the count of placement rows for the course (one row = one hour);
 * `required` is `course.hours` (courses.hours_per_week). Merge-children legitimately
 * carry 0 required hours and are reported as such — never a warning. Read-only: this is
 * a display derivation, not completeness enforcement (the finalize gate is deferred).
 */
export const deriveHours = (placements: PlannerPlacement[], catalog: GroupingCourse[]): Map<string, HoursStat> => {
  const placedByCourse = new Map<string, number>();
  for (const placement of placements) {
    placedByCourse.set(placement.courseId, (placedByCourse.get(placement.courseId) ?? 0) + 1);
  }

  const stats = new Map<string, HoursStat>();
  for (const course of catalog) {
    stats.set(course.id, { placed: placedByCourse.get(course.id) ?? 0, required: course.hours });
  }
  return stats;
};

/**
 * Plan-wide rollup: how many courses still need hours (placed < required). A course is
 * "complete" once its required hours are placed; 0-hour merge-children (required 0) are
 * complete from the start and never counted. Over-placed courses count as complete.
 */
export const countIncompleteCourses = (stats: Map<string, HoursStat>): number => {
  let incomplete = 0;
  for (const { placed, required } of stats.values()) {
    if (placed < required) incomplete += 1;
  }
  return incomplete;
};
