import { useMemo } from "react";
import type { CellWiring } from "./slot-cell/SlotCellHost";

/**
 * Bundle the single board's per-cell handlers + drag-hint state into one referentially-stable
 * `CellWiring` object, mirroring the pattern the combined view already uses (`PairedPlannerGrid`
 * spreads `{...column.wiring}`). The single path can then pass ONE `wiring` prop down through the
 * grid and `{...wiring}` it into each `SlotCellHost`, instead of hand-re-listing the 11 fields at
 * every hop.
 *
 * There is no React Compiler transform (only the lint plugin), so this memo is the manual-memo
 * contract: given referentially-stable inputs the returned object survives a re-render (`toBe`), so
 * an idle board does not hand every cell a fresh wiring object on each render. A broad-fan-out
 * Context was rejected for exactly this reason — `dropHints`/`hintMode` change on every drag tick, so
 * one shared Context value would re-render all cells against the <200ms drag budget (see
 * `ui-conventions.md` §"State management").
 */
export function useCellWiring(wiring: CellWiring): CellWiring {
  const {
    dropHints,
    hintMode,
    isExploded,
    justDuplicated,
    onRemove,
    onSetWeek,
    onToggleBundle,
    onRemoveBundle,
    onDuplicateBundle,
    onLiftBundle,
    onInspect,
  } = wiring;
  return useMemo<CellWiring>(
    () => ({
      dropHints,
      hintMode,
      isExploded,
      justDuplicated,
      onRemove,
      onSetWeek,
      onToggleBundle,
      onRemoveBundle,
      onDuplicateBundle,
      onLiftBundle,
      onInspect,
    }),
    [
      dropHints,
      hintMode,
      isExploded,
      justDuplicated,
      onRemove,
      onSetWeek,
      onToggleBundle,
      onRemoveBundle,
      onDuplicateBundle,
      onLiftBundle,
      onInspect,
    ],
  );
}
