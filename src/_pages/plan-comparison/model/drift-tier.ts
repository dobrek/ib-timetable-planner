import type { LoadedPlan } from "../api/load-plan-analysis";

/**
 * How far a comparison can be trusted.
 *
 * | Tier            | Condition                      | Meaning                                                                              |
 * |-----------------|--------------------------------|--------------------------------------------------------------------------------------|
 * | `incomparable`  | the grid differs               | board-shape, day-edge, slot-census and week-symmetry metrics are meaningless          |
 * | `catalog-drift` | the catalogs are not identical | catalog-*dependent* metrics are apples-to-oranges; catalog-*independent* ones survive |
 * | `clean`         | nothing moved                  | full comparison valid — the clone → generate flow the analyzer was validated on       |
 *
 * Grid mismatch **outranks** catalog drift: a different board shape invalidates strictly more than a
 * different catalog does, so it is the tier that gets reported.
 *
 * **The tier is all the reader gets, and that is deliberate.** An earlier cut folded a full structured
 * diff and printed the counts ("4 courses removed, 61 students added, 652 choices added…"). Between two
 * genuinely different plans that is a wall of numbers, and it still cannot answer the only question a
 * count raises — *which* course, *which* student — without naming rows, which is a second table, not a
 * banner. So the banner answers what it can answer honestly: these catalogs are not the same, therefore
 * these particular metrics are measuring different populations. `catalogEqual` comes straight from the
 * fingerprint, which is the check the tier always actually rested on.
 */
export const driftTier = ({ gridEqual, catalogEqual }: DriftInput): DriftTier => {
  if (!gridEqual) return "incomparable";
  return catalogEqual ? "clean" : "catalog-drift";
};

export type DriftInput = {
  gridEqual: boolean;
  /** Equal natural-key fingerprints — NOT equal ids: `clone_plan` re-mints every UUID, so a clone and
   *  its source share no id at all yet have precisely the same catalog. */
  catalogEqual: boolean;
};

export type DriftTier = "clean" | "catalog-drift" | "incomparable";

export type GridShape = { days: number; periods: number };

export const gridOf = (plan: LoadedPlan): GridShape => ({ days: plan.input.days, periods: plan.input.periods });

export const sameGrid = (reference: GridShape, other: GridShape): boolean =>
  reference.days === other.days && reference.periods === other.periods;
