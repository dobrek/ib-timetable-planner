import type { Cohort } from "@/shared/config";
import type { TeacherRow } from "./teacher";

export type CohortFilter = "all" | Cohort;

/**
 * Pure catalog filter: narrow teacher rows by text search and optional cohort filter.
 * Text matches against code, fullName, and course names within assignments
 * (case-insensitive substring). Cohort filter keeps teachers with ≥1 assignment in the
 * matching cohort. Does not mutate its inputs.
 */
export function filterTeachers(
  teachers: readonly TeacherRow[],
  query: string,
  cohortFilter: CohortFilter,
): TeacherRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return teachers.filter((teacher) => {
    if (cohortFilter !== "all") {
      const hasAssignmentInCohort = teacher.assignments.some((a) => a.cohort === cohortFilter);
      if (!hasAssignmentInCohort) return false;
    }

    if (normalizedQuery.length === 0) return true;

    if (teacher.code.toLowerCase().includes(normalizedQuery)) return true;
    if (teacher.fullName?.toLowerCase().includes(normalizedQuery)) return true;

    return teacher.assignments.some((a) => a.name.toLowerCase().includes(normalizedQuery));
  });
}
