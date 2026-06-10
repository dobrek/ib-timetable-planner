/** A cohort presented for tabs/selection: opaque id + school-year display label. */
export type CohortOption = {
  id: string;
  label: string;
};

/**
 * Project name-ordered cohort rows into display options. Ordering is naive
 * (alphabetical name → first = "Year 1") — stable for the two seed names; the future
 * cohort-CRUD slice replaces it with an explicit ordinal.
 */
export function toOrderedCohorts(rows: readonly { id: string }[]): CohortOption[] {
  return rows.map((row, index) => ({ id: row.id, label: `Year ${index + 1}` }));
}
