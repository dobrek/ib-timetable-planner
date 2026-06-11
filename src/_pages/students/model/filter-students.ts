import type { StudentRow } from "./student";

/**
 * Pure catalog filter: narrow student rows to one cohort, then by a case-insensitive
 * substring match on `fullName`. Does not mutate its inputs. (The signature widens with
 * `selectedCourseIds` in Phase 3.)
 */
export function filterStudents(students: readonly StudentRow[], cohortId: string, query: string): StudentRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return students.filter((student) => {
    if (student.cohortId !== cohortId) return false;
    if (normalizedQuery.length === 0) return true;
    return student.fullName.toLowerCase().includes(normalizedQuery);
  });
}
