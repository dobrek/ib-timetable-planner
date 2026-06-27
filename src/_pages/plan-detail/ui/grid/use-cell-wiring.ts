import { useMemo } from "react";
import type { CellWiring } from "./slot-cell/SlotCellHost";

/**
 * Bundle the single board's per-cell handlers + drag-hint state into ONE `CellWiring` object,
 * mirroring the pattern the combined view already uses (`PairedPlannerGrid` spreads
 * `{...column.wiring}`). The single path can then pass one `wiring` prop down through the grid and
 * `{...wiring}` it into each `SlotCellHost`, instead of hand-re-listing the 11 fields at every hop.
 * The win here is the 11-fields-→-1-prop collapse, not memoization.
 *
 * The `useMemo` only yields a stable object when its inputs are stable; on the live single board
 * they currently are NOT (`usePlacements` returns plain `function` handlers, and `liftBundle` is a
 * local closure), so the object is rebuilt every render. That is harmless: the cell components are
 * deliberately un-memoized (see `SlotCell.tsx`), so wiring identity never gates a re-render. The
 * `toBe` unit test exercises the idealized stable-inputs contract, not the board's live inputs.
 *
 * A broad-fan-out Context was still rejected: `dropHints`/`hintMode` change on every drag tick, so
 * one shared Context value would re-render all cells against the <200ms drag budget (see
 * `ui-conventions.md` §"State management"). The spread keeps that fan-out prop-local.
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
