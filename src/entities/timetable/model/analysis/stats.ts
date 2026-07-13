import type { Distribution, Extreme } from "./types";

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

/** The largest entry, or `null` when there is nothing to rank (nullable over a sentinel row). */
export const worstOf = (entries: Extreme[]): Extreme | null =>
  entries.reduce<Extreme | null>((worst, entry) => (worst === null || entry.value > worst.value ? entry : worst), null);

/** Linear-interpolated quantile over an ascending list (numpy's default convention). */
const quantile = (sorted: number[], q: number): number => {
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
