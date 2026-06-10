import type { TeacherRow } from "./teacher";

export type YearFilter = "all" | "y1" | "y2";

/**
 * Pure catalog filter: narrow teacher rows by text search and optional year filter.
 * Text matches against code, fullName, and course names within assignments
 * (case-insensitive substring). Year filter keeps teachers with ≥1 assignment
 * in the matching cohort. Does not mutate its inputs.
 */
export function filterTeachers(
  teachers: readonly TeacherRow[],
  query: string,
  yearFilter: YearFilter,
  cohortIds: { y1: string; y2: string },
): TeacherRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return teachers.filter((teacher) => {
    if (yearFilter !== "all") {
      const targetCohortId = yearFilter === "y1" ? cohortIds.y1 : cohortIds.y2;
      const hasAssignmentInCohort = teacher.assignments.some((a) => a.cohortId === targetCohortId);
      if (!hasAssignmentInCohort) return false;
    }

    if (normalizedQuery.length === 0) return true;

    if (teacher.code.toLowerCase().includes(normalizedQuery)) return true;
    if (teacher.fullName?.toLowerCase().includes(normalizedQuery)) return true;

    return teacher.assignments.some((a) => a.name.toLowerCase().includes(normalizedQuery));
  });
}
