import type { PlannerGrouping } from "./grouping";

/**
 * Deterministic, total ordering for palette grouping boxes: total students
 * (`coverageCount`) desc → course count (`memberIds.length`) desc → `id` asc.
 * The `id` tiebreaker (stable across reloads) guarantees a total order even when
 * two groups share the same student and course counts. Pure — returns a new array
 * (`toSorted`), never mutates the input. Mirrors `compute-groupings.ts` comparator.
 */
export const sortGroupingsForPalette = (groupings: PlannerGrouping[]): PlannerGrouping[] =>
  groupings.toSorted(compareGroupings);

const compareGroupings = (a: PlannerGrouping, b: PlannerGrouping): number => {
  if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
  if (b.memberIds.length !== a.memberIds.length) return b.memberIds.length - a.memberIds.length;
  return a.id.localeCompare(b.id);
};
