import { enumerateOppositeWeekPairs, enumerateVariants } from "./enumerate";
import { scoreVariant } from "./score";
import type { GroupingCourse, GroupingResult, GroupingVariant } from "./grouping";

const DEFAULT_CAP = 10_000;

export const computeGroupings = (courses: GroupingCourse[], opts?: { cap?: number }): GroupingResult[] => {
  const cap = opts?.cap ?? DEFAULT_CAP;

  // v1 opposite-week pairs, keyed to their first (lexicographically-lower) member's seed so each
  // pair is emitted once. Dedup across seeds happens at persist (`toDistinctMemberSets`).
  const oppositeBySeed = new Map<string, GroupingVariant[]>();
  for (const [a, b] of enumerateOppositeWeekPairs(courses)) {
    const variant = scoreVariant([a, b], a, { oppositeWeek: true });
    const bucket = oppositeBySeed.get(a.id);
    if (bucket) bucket.push(variant);
    else oppositeBySeed.set(a.id, [variant]);
  }

  return courses.map((seed) => {
    const parallel = enumerateVariants(seed, courses, cap).map((set) => scoreVariant(set, seed));
    const opposite = oppositeBySeed.get(seed.id) ?? [];
    return { seedId: seed.id, variants: [...parallel, ...opposite].toSorted(compareVariants) };
  });
};

const compareVariants = (a: GroupingVariant, b: GroupingVariant): number => {
  if (b.score !== a.score) return b.score - a.score;
  if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
  return a.memberIds.join(",").localeCompare(b.memberIds.join(","));
};
