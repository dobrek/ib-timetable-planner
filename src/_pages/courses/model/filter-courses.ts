import type { Cohort } from "@/shared/config";
import type { CourseRow } from "./course";

/**
 * Pure catalog filter: narrow to the active cohort's rows, optionally drop composite
 * merge parents, then (if any teachers are selected) keep rows taught by one of them.
 * An empty teacher selection means "all". Does not mutate its inputs (functional
 * clean-code preference).
 */
export function filterCourses(
  courses: readonly CourseRow[],
  activeCohort: Cohort,
  selectedTeacherIds: readonly string[],
  hideMerged = false,
): CourseRow[] {
  const teacherFilter = new Set(selectedTeacherIds);
  return courses.filter((course) => {
    if (course.cohort !== activeCohort) return false;
    if (hideMerged && course.isMerged) return false;
    if (teacherFilter.size === 0) return true;
    return course.teacherId !== null && teacherFilter.has(course.teacherId);
  });
}
