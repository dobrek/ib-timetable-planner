import type { StudentRow } from "./student";

/**
 * Pure catalog filter: narrow student rows to one cohort, then by a case-insensitive
 * substring match on `fullName`, then to students who chose at least one of the selected
 * courses (empty selection = keep all). Does not mutate its inputs.
 */
export function filterStudents(
  students: readonly StudentRow[],
  cohortId: string,
  query: string,
  selectedCourseIds: readonly string[] = [],
): StudentRow[] {
  const normalizedQuery = query.trim().toLowerCase();
  const selected = new Set(selectedCourseIds);

  return students.filter((student) => {
    if (student.cohortId !== cohortId) return false;
    if (normalizedQuery.length > 0 && !student.fullName.toLowerCase().includes(normalizedQuery)) return false;
    if (selected.size > 0 && !student.choiceCourseIds.some((id) => selected.has(id))) return false;
    return true;
  });
}
