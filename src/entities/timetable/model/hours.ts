import type { GroupingCourse } from "@/shared/lib/catalog-hash";
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

/** A course's identity plus its placed/required hours — no display concern (resolved at the edge). */
export type CourseHours = { courseId: string; placed: number; required: number };

/** Courses still needing board hours (placed < required): the "Missing" set for the top-bar breakdown. */
export const deriveUnplaced = (stats: Map<string, HoursStat>): CourseHours[] =>
  [...stats]
    .filter(([, { placed, required }]) => placed < required)
    .map(([courseId, { placed, required }]) => ({ courseId, placed, required }));

/**
 * Courses with too many board hours (placed > required): the "Over-placed" set. The `required > 0`
 * guard is load-bearing — a 0-hour merge-child stays in the catalog as a placeable course, so a
 * dropped one reads as `{ placed: 1, required: 0 }`; without the guard `placed > required` would
 * flag it. A required-0 course is never "over-placed" by design.
 */
export const deriveOverplaced = (stats: Map<string, HoursStat>): CourseHours[] =>
  [...stats]
    .filter(([, { placed, required }]) => placed > required && required > 0)
    .map(([courseId, { placed, required }]) => ({ courseId, placed, required }));

/**
 * The two independent clamped hour totals the bar headline needs, summed from the already-derived
 * `deriveUnplaced` / `deriveOverplaced` sets so the stats Map is walked once (single source of truth).
 * The two sums stay separate — never netted: over-placement on one course must not cancel a deficit on
 * another (Math 4/2 + English 0/2 reads "2 left · 2 over", not zero). The `required > 0` guard lives in
 * `deriveOverplaced`, so a 0-hour merge-child never reaches `overplaced` and contributes nothing.
 */
export const summarizeHours = (
  unplaced: CourseHours[],
  overplaced: CourseHours[],
): { hoursLeft: number; hoursOver: number } => ({
  hoursLeft: unplaced.reduce((sum, { placed, required }) => sum + (required - placed), 0),
  hoursOver: overplaced.reduce((sum, { placed, required }) => sum + (placed - required), 0),
});
