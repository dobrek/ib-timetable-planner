// The catalog projection + fingerprint shapes live in shared (the plans hub's clone
// flow recomputes hashes too); re-exported here so constraint-core signatures are
// unchanged. `@/shared/lib/catalog-hash` is deep-importable and astro-free.
export type { ComputeWarning, GroupingCourse } from "@/shared/lib/catalog-hash";

export type GroupingVariant = {
  size: number;
  coverageCount: number;
  rank: number;
  score: number;
  memberIds: string[];
  /** True for a both-bi-weekly conflicting pair surfaced as a placeable opposite-week (A/B) share. */
  oppositeWeek?: boolean;
};

export type GroupingResult = {
  seedId: string;
  variants: GroupingVariant[];
};

/** A palette hint box: a deduped member-set read from `course_groupings`. */
export type PlannerGrouping = {
  id: string;
  memberIds: string[];
  coverageCount: number;
  score: number;
  /** True when this is an opposite-week (A/B) share — members run on alternating weeks. */
  oppositeWeek: boolean;
};
