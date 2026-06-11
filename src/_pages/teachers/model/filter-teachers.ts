import type { Cohort } from "@/shared/config";
import type { TeacherRow } from "./teacher";

export type YearFilter = "all" | "y1" | "y2";

const YEAR_TO_COHORT: Record<Exclude<YearFilter, "all">, Cohort> = { y1: "dp1", y2: "dp2" };

/**
 * Pure catalog filter: narrow teacher rows by text search and optional year filter.
 * Text matches against code, fullName, and course names within assignments
 * (case-insensitive substring). Year filter keeps teachers with ≥1 assignment in the
 * matching cohort. Does not mutate its inputs.
 */
export function filterTeachers(teachers: readonly TeacherRow[], query: string, yearFilter: YearFilter): TeacherRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return teachers.filter((teacher) => {
    if (yearFilter !== "all") {
      const targetCohort = YEAR_TO_COHORT[yearFilter];
      const hasAssignmentInCohort = teacher.assignments.some((a) => a.cohort === targetCohort);
      if (!hasAssignmentInCohort) return false;
    }

    if (normalizedQuery.length === 0) return true;

    if (teacher.code.toLowerCase().includes(normalizedQuery)) return true;
    if (teacher.fullName?.toLowerCase().includes(normalizedQuery)) return true;

    return teacher.assignments.some((a) => a.name.toLowerCase().includes(normalizedQuery));
  });
}
