import type { TeacherRow } from "./teacher";

/**
 * Order catalog rows by full name (case-insensitive), teachers without a name last,
 * code as the tiebreaker. Does not mutate its input.
 */
export function sortTeachers(rows: readonly TeacherRow[]): TeacherRow[] {
  return [...rows].sort((a, b) => {
    const nameA = a.fullName?.toLowerCase() ?? NAME_MISSING_SENTINEL;
    const nameB = b.fullName?.toLowerCase() ?? NAME_MISSING_SENTINEL;
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.code.localeCompare(b.code);
  });
}

/** Sorts after every real name (highest BMP code point). */
const NAME_MISSING_SENTINEL = "\uffff";
