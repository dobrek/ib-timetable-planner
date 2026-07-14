/**
 * The hub's ephemeral "which plans am I comparing" set.
 *
 * Selection lives HERE, on the list of plans, rather than on the comparison page. A picker on the
 * comparison page was a second, worse plan browser — and worse, it was client state driving an
 * SSR'd scoreboard, so changing it left the numbers describing the *previous* plans while the control
 * claimed otherwise. Selecting where the plans already live removes that whole class of disagreement:
 * the comparison page then renders strictly what its URL names.
 *
 * Mirrors `students`' `use-catalog-selection` (pure helpers + a thin hook) rather than importing it —
 * a same-layer cross-slice `_pages` import is forbidden.
 */

export const EMPTY_SELECTION: ReadonlySet<string> = new Set();

/** Add the id if absent, remove it if present. */
export const toggleId = (current: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Select-all semantics: every row already ticked → clear; otherwise take them all. */
export const toggleAllSelection = (
  current: ReadonlySet<string>,
  visibleIds: readonly string[],
): ReadonlySet<string> => {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
  return allSelected ? EMPTY_SELECTION : new Set(visibleIds);
};

/**
 * The comparison URL for a selection, in the row order the hub renders — **no baseline**.
 *
 * No plan is the reference the others are scored against: `analyzePlan` has zero pairwise coupling, so
 * every number in the scoreboard is a property of one plan alone. The comparison reports; it never
 * judges. The order here is just the order the rows appear in.
 */
export const compareHref = (plans: readonly { id: string }[], selectedIds: ReadonlySet<string>): string => {
  const ids = plans.filter((plan) => selectedIds.has(plan.id)).map((plan) => plan.id);
  return `/plans/compare?plans=${ids.join(",")}`;
};

/** Comparing needs at least two plans — one plan's feature vector is just that plan's feature vector. */
export const canCompare = (selectedIds: ReadonlySet<string>): boolean => selectedIds.size >= 2;
