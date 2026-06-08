import type { CourseRow } from "@/components/courses/types";

/**
 * Pure catalog filter: narrow to the active cohort's rows, then (if any teachers are
 * selected) to rows taught by one of them. An empty teacher selection means "all".
 * Does not mutate its inputs (functional clean-code preference).
 */
export function filterCourses(
  courses: readonly CourseRow[],
  activeCohortId: string,
  selectedTeacherIds: readonly string[],
): CourseRow[] {
  const teacherFilter = new Set(selectedTeacherIds);
  return courses.filter((course) => {
    if (course.cohortId !== activeCohortId) return false;
    if (teacherFilter.size === 0) return true;
    return course.teacherId !== null && teacherFilter.has(course.teacherId);
  });
}
