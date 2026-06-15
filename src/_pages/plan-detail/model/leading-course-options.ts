import type { PlannerGrouping } from "./grouping";

/** A leading-course filter option: a distinct member course plus the number of groupings it appears in. */
export type LeadingCourseOption = { id: string; name: string; groupCount: number };

/**
 * Distinct member courses across `groupings`, each enriched with its display `name`
 * (`names[id]`, falling back to the `id`) and its group count — the number of
 * groupings whose member set contains it. Counts accumulate in a single pass over
 * `memberIds` (one `Map`, not `filter().length` per id). Returned unsorted — the
 * caller picks an ordering (`sortByGroupCount` / `sortByName`).
 */
export const leadingCourseOptions = (
  groupings: PlannerGrouping[],
  names: Record<string, string>,
): LeadingCourseOption[] => {
  const counts = new Map<string, number>();
  for (const grouping of groupings) {
    for (const id of grouping.memberIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts].map(([id, groupCount]) => ({ id, name: names[id] ?? id, groupCount }));
};

/**
 * Default ordering: fewest groupings first, so the most constrained courses surface
 * at the top. `toSorted` — group count asc → `name.localeCompare` → `id` for a
 * deterministic total order across reloads.
 */
export const sortByGroupCount = (options: LeadingCourseOption[]): LeadingCourseOption[] =>
  options.toSorted(compareByGroupCount);

/** Alphabetic ordering: `toSorted` by `name.localeCompare`, then `id` as the tiebreaker. */
export const sortByName = (options: LeadingCourseOption[]): LeadingCourseOption[] => options.toSorted(compareByName);

const compareByGroupCount = (a: LeadingCourseOption, b: LeadingCourseOption): number => {
  if (a.groupCount !== b.groupCount) return a.groupCount - b.groupCount;
  return compareByName(a, b);
};

const compareByName = (a: LeadingCourseOption, b: LeadingCourseOption): number => {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
};
