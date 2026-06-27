import { hasIntersection } from "../collision/intersects";
import type { GroupingCourse } from "./grouping";

// Thrown when either cap (distinct results or traversal nodes) is crossed. The
// endpoint branches on this type to return 422 — never match on the message text.
export class EnumerationCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnumerationCapError";
  }
}

// Hard ceiling on recursive node visits, expressed as a generous multiple of the
// result cap. The result cap bounds DISTINCT maximal sets; this bounds the TRAVERSAL
// itself, because a dense/near-complete conflict graph re-discovers the same few
// maximal sets through factorially many orderings — `seen.size` stays small while
// CPU explodes, so the result cap alone never fires. Fail loud before that happens.
const TRAVERSAL_LIMIT_FACTOR = 1000;

export const enumerateVariants = (seed: GroupingCourse, all: GroupingCourse[], cap: number): GroupingCourse[][] => {
  const sortedCandidates = all.filter((c) => c.id !== seed.id).toSorted((a, b) => a.id.localeCompare(b.id));

  // Collect distinct maximal sets during the traversal, not after — the cap is
  // checked before each new set is kept, so we never materialize more than `cap`
  // results (memory + CPU bounded) and fail loud the moment the bound is crossed.
  const seen = new Set<string>();
  const results: GroupingCourse[][] = [];
  const maxVisits = cap * TRAVERSAL_LIMIT_FACTOR;
  let visits = 0;

  const collect = (current: GroupingCourse[], candidates: GroupingCourse[]): void => {
    visits += 1;
    if (visits > maxVisits)
      throw new EnumerationCapError(
        `Enumeration cap exceeded: traversal for seed "${seed.id}" visited over ${maxVisits} nodes ` +
          `(conflict graph too dense). Reduce catalog size or raise the cap.`,
      );
    const compatible = candidates.filter((c) => !hasIntersection(c, current));
    if (compatible.length === 0) {
      const key = setKey(current);
      if (seen.has(key)) return;
      if (seen.size >= cap)
        throw new EnumerationCapError(
          `Enumeration cap of ${cap} exceeded for seed "${seed.id}". Reduce catalog size or raise the cap.`,
        );
      seen.add(key);
      results.push(current);
      return;
    }
    for (const next of compatible) {
      collect(
        [...current, next],
        compatible.filter((c) => !hasIntersection(c, [next])),
      );
    }
  };

  collect([seed], sortedCandidates);
  return results;
};

const setKey = (set: GroupingCourse[]): string =>
  set
    .map((c) => c.id)
    .toSorted()
    .join(",");

/**
 * Each unordered both-bi-weekly **conflicting** pair (a soft edge: `hasIntersection` AND both
 * `weekMode === "biweekly"`), surfaced as a placeable opposite-week (A/B) grouping. A soft pair
 * can never be in a true-parallel set, so `enumerateVariants` already excludes it — this is the
 * additive v1 pass that recovers it. O(edges) over the catalog; ids sorted so each pair is the
 * lexicographically-first member first (deterministic, dedup-friendly).
 */
export const enumerateOppositeWeekPairs = (courses: GroupingCourse[]): [GroupingCourse, GroupingCourse][] => {
  const sorted = courses.toSorted((a, b) => a.id.localeCompare(b.id));
  const pairs: [GroupingCourse, GroupingCourse][] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      if (
        sorted[i].weekMode === "biweekly" &&
        sorted[j].weekMode === "biweekly" &&
        hasIntersection(sorted[i], [sorted[j]])
      )
        pairs.push([sorted[i], sorted[j]]);
  return pairs;
};
