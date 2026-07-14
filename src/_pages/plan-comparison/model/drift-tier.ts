import { CATEGORIES, type CatalogDiff } from "./catalog-diff";

/**
 * How far a comparison can be trusted. Encoded in the model even though v1's UI only renders a
 * banner: the information is nearly free once the fingerprint and the diff exist, and it lets a later
 * iteration dim the untrustworthy rows without a re-architecture.
 *
 * | Tier            | Condition                                  | Meaning                                                                    |
 * |-----------------|--------------------------------------------|----------------------------------------------------------------------------|
 * | `incomparable`  | the grid differs                           | board-shape, day-edge, slot-census and week-symmetry metrics are meaningless |
 * | `catalog-drift` | course/teacher/student/choice/availability | catalog-*dependent* metrics are apples-to-oranges; catalog-*independent* ones survive |
 * | `clean`         | nothing moved                              | full comparison valid — the clone → generate flow the analyzer was validated on |
 *
 * Grid mismatch **outranks** catalog drift: a different board shape invalidates strictly more than a
 * different catalog does, so it is the tier that gets reported.
 */
export const driftTier = (diff: CatalogDiff): DriftTier => {
  if (!diff.grid.equal) return "incomparable";
  return CATEGORIES.some((category) => moved(diff, category)) ? "catalog-drift" : "clean";
};

export type DriftTier = "clean" | "catalog-drift" | "incomparable";

const moved = (diff: CatalogDiff, category: (typeof CATEGORIES)[number]): boolean => {
  const { added, removed, changed } = diff[category];
  return added > 0 || removed > 0 || changed > 0;
};
