import type { WeekLane } from "./lanes";
import type { Distribution, Extreme, GapExtreme } from "./types";

/**
 * The two summaries every lens returns instead of a bare total: a distribution (where the signal
 * actually lives — a mean over a complete board is a catalog constant) and the worst entry (the
 * fairness question is always about the worst case, never the average).
 */

const EMPTY_DISTRIBUTION: Distribution = { count: 0, min: 0, p10: 0, median: 0, mean: 0, max: 0, variance: 0 };

/** Summarize a value set. Quantiles interpolate linearly between neighbours (so an even-sized
 *  set medians to the midpoint of its two central values, matching the SQL v0 report). */
export const distribution = (values: number[]): Distribution => {
  if (values.length === 0) return EMPTY_DISTRIBUTION;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    mean,
    max: sorted[sorted.length - 1],
    variance: sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length,
  };
};

/** The largest entry, or `null` when there is nothing to rank (nullable over a sentinel row). Generic so
 *  a `GapExtreme[]` ranks to a `GapExtreme` — the per-week figure rides along with the worst entry. */
export const worstOf = <T extends Extreme>(entries: T[]): T | null =>
  entries.reduce<T | null>((worst, entry) => (worst === null || entry.value > worst.value ? entry : worst), null);

/**
 * Per-entity gap totals as `GapExtreme`s, seeded so an entity with an empty board ranks at 0 rather than
 * dropping out of the fairness lens (an incomplete board must not read as compact for the people it
 * stranded). `value` sums holes across BOTH week lanes — the fortnight, matching the objective; `perWeek`
 * is the busier single week, the figure a reader counts on one week's grid.
 */
export const gapExtremes = (
  lanes: readonly { entityKey: string; weekLane: WeekLane; stats: { holes: number } }[],
  seed: Iterable<string>,
): GapExtreme[] => {
  const fortnight = new Map<string, number>([...seed].map((key) => [key, 0]));
  const byWeek = new Map<string, { a: number; b: number }>();
  for (const lane of lanes) {
    fortnight.set(lane.entityKey, (fortnight.get(lane.entityKey) ?? 0) + lane.stats.holes);
    const weeks = byWeek.get(lane.entityKey) ?? { a: 0, b: 0 };
    weeks[lane.weekLane] += lane.stats.holes;
    byWeek.set(lane.entityKey, weeks);
  }
  return [...fortnight].map(([key, value]) => {
    const weeks = byWeek.get(key) ?? { a: 0, b: 0 };
    return { key, value, perWeek: Math.max(weeks.a, weeks.b) };
  });
};

/** Linear-interpolated quantile over an ascending list (numpy's default convention). */
const quantile = (sorted: number[], q: number): number => {
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
