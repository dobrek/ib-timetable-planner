import { useState } from "react";
import { isCellExploded, setCellExploded, type ExplodedCells } from "./exploded-cells";

export type UseExplodedCells = {
  /** Is `(day, period)` currently exploded (ungrouped view)? */
  isExploded: (day: number, period: number) => boolean;
  /** Toggle a cell's view. `currentlyBundled` true ⇒ explode (ungroup); false ⇒ collapse (group). */
  toggleExploded: (day: number, period: number, currentlyBundled: boolean) => void;
};

/**
 * Ephemeral in-session exploded-view state — which cells are expanded into individual
 * chips. Replaces the retired persisted ungroup-override stack: no server writes, no
 * persistence, can't error. Resets to all-grouped on mount/reload (the bundled default is
 * the point of first-class bundles). Reload-safe because no board op refetches.
 */
export function useExplodedCells(): UseExplodedCells {
  const [exploded, setExploded] = useState<ExplodedCells>(() => new Set());

  return {
    isExploded: (day, period) => isCellExploded(exploded, day, period),
    toggleExploded: (day, period, currentlyBundled) => {
      setExploded((prev) => setCellExploded(prev, day, period, currentlyBundled));
    },
  };
}
