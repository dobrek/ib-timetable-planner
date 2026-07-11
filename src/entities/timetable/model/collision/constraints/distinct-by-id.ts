import type { GroupingCourse } from "@/shared/lib/catalog-hash";

/**
 * First occurrence of each course id in a cell. A cell can hold a same-course duplicate, and the
 * day-scoped rules (`early-finish-edge`, `course-day-stacking`) blame a course once regardless of
 * how many placements it has in the cell — so both dedupe occupants by id before evaluating.
 */
export const distinctById = (occupants: GroupingCourse[]): GroupingCourse[] => {
  const seen = new Set<string>();
  return occupants.filter((course) => !seen.has(course.id) && Boolean(seen.add(course.id)));
};
