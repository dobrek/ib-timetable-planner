/**
 * Pure set diff between a student's current choices and the submitted next set. The update
 * path inserts `toAdd` before deleting `toRemove` so a mid-flight failure can only leave a
 * visible superset, never lost choices. Diffing (rather than delete-all/insert-all) is
 * required by the `UNIQUE (student_id, course_id)` constraint — re-inserting an unchanged
 * choice would conflict.
 */
export const diffChoices = (
  current: readonly string[],
  next: readonly string[],
): { toAdd: string[]; toRemove: string[] } => {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    toAdd: next.filter((id) => !currentSet.has(id)),
    toRemove: current.filter((id) => !nextSet.has(id)),
  };
};
