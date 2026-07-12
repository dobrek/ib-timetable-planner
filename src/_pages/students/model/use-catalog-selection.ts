import { useCallback, useState } from "react";

export type CatalogSelection = {
  selectedIds: ReadonlySet<string>;
  toggle: (id: string) => void;
  toggleAll: (visibleIds: readonly string[]) => void;
  clear: () => void;
};

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Owns the ephemeral selected-student set for the catalog, scoped to the current filter view
 * (WYSIWYG). `filterSignature` serializes cohort + query + courseIds in StudentCatalog; whenever
 * it changes — any filter change, from any source, including setActiveCohort's coupled courseIds
 * reset — the selection is discarded, so a hidden row can never stay selected. One mechanism for
 * every change source (setters are the only in-island source: back/forward is a full page load).
 * Reset happens during render (no effect flash). Post-apply clearing comes free — refreshPage() is
 * a full navigation that remounts the island, discarding this state.
 */
export function useCatalogSelection(filterSignature: string): CatalogSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY);
  const [lastSignature, setLastSignature] = useState(filterSignature);

  if (lastSignature !== filterSignature) {
    setLastSignature(filterSignature);
    setSelectedIds(EMPTY);
  }

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) => toggleId(current, id));
  }, []);

  const toggleAll = useCallback((visibleIds: readonly string[]) => {
    setSelectedIds((current) => toggleAllSelection(current, visibleIds));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(EMPTY);
  }, []);

  return { selectedIds, toggle, toggleAll, clear };
}

/** Add id if absent, remove if present. */
export const toggleId = (current: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/**
 * Select-all semantics: if every visible row is already selected, clear to empty; otherwise
 * select all visible rows (a partial selection becomes full). Empty visible set → empty.
 */
export const toggleAllSelection = (
  current: ReadonlySet<string>,
  visibleIds: readonly string[],
): ReadonlySet<string> => {
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
  return allSelected ? EMPTY : new Set(visibleIds);
};
