import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { deriveHours, deriveUnplaced } from "../hours";
import type { PlannerPlacement } from "../placement";
import type { CourseDeficit } from "./types";

/**
 * What the generator must place for one cohort: each course's required hours minus its board
 * rows (`deriveUnplaced`) minus its parked coverage — a parked bundle member represents one
 * off-board hour of its course, and parked-covered deficits are skipped (author decision).
 * Clamped per course (never negative, never netted across courses), so an over-parked course
 * simply drops out. Note the deliberate divergence from the courses-left counter, which counts
 * parked hours as missing: "still to place by hand" and "still to place by the generator" are
 * different questions.
 */
export const deriveGenerationDeficits = (
  placements: PlannerPlacement[],
  courses: GroupingCourse[],
  parkedCourseIds: string[],
): CourseDeficit[] => {
  const parkedByCourse = countByCourse(parkedCourseIds);
  return deriveUnplaced(deriveHours(placements, courses))
    .map(({ courseId, placed, required }) => ({
      courseId,
      missing: required - placed - (parkedByCourse.get(courseId) ?? 0),
    }))
    .filter(({ missing }) => missing > 0);
};

const countByCourse = (courseIds: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const courseId of courseIds) counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
  return counts;
};
