import { useEffect, useRef, useState } from "react";
import type { Cohort } from "@/shared/config";
import { bundleSlot, unbundleSlot } from "../api/slot-bundle-client";
import {
  addOverrideOptimistic,
  addOverrideReconcile,
  addOverrideRollback,
  hasOverride,
  removeOverrideOptimistic,
  removeOverrideRollback,
  type LocalSlotOverride,
  type SlotOverride,
} from "./slot-bundle";
import type { PlacementError } from "./placement-transitions";

type UseSlotBundlesArgs = { planId: string; cohort: Cohort };

export type UseSlotBundles = {
  overrides: LocalSlotOverride[];
  isOverridden: (day: number, period: number) => boolean;
  toggleBundle: (day: number, period: number, currentlyBundled: boolean) => void;
  error: PlacementError | null;
  clearError: () => void;
};

/**
 * Owns island-local unbundle-override state and its optimistic write path. This is
 * persisted shared state (not a per-device cosmetic), so it mirrors `usePlacements` —
 * optimistic state + an API client + pure transitions, seeded from props — rather than
 * the localStorage shape of `useHintMode`. Errors reuse the `PlacementError` shape so the
 * toggle surfaces through the same `ErrorBanner` as placement writes.
 *
 * Verb→op inversion (see api/slot-bundles.ts): ungrouping INSERTS an override
 * (`unbundleSlot`), regrouping DELETES it (`bundleSlot`).
 */
export function useSlotBundles(initial: SlotOverride[], { planId, cohort }: UseSlotBundlesArgs): UseSlotBundles {
  const [overrides, setOverrides] = useState<LocalSlotOverride[]>(initial);
  const [error, setError] = useState<PlacementError | null>(null);
  const overridesRef = useLatest(overrides);

  function toggleBundle(day: number, period: number, currentlyBundled: boolean) {
    if (currentlyBundled) void persistUnbundle(day, period);
    else void persistRebundle(day, period);
  }

  // Ungroup: add an override and persist the insert. Guard against a double-toggle
  // that would stack duplicate optimistic overrides for one cell.
  async function persistUnbundle(day: number, period: number) {
    if (hasOverride(overridesRef.current, day, period)) return;
    setOverrides((prev) => addOverrideOptimistic(prev, day, period));

    try {
      await unbundleSlot({ planId, cohort, day, period });
      setOverrides((prev) => addOverrideReconcile(prev, day, period));
    } catch (err: unknown) {
      setOverrides((prev) => addOverrideRollback(prev, day, period));
      setError(errorOf(err));
    }
  }

  // Regroup: remove the override and persist the delete.
  async function persistRebundle(day: number, period: number) {
    if (!hasOverride(overridesRef.current, day, period)) return;
    setOverrides((prev) => removeOverrideOptimistic(prev, day, period));

    try {
      await bundleSlot({ planId, cohort, day, period });
    } catch (err: unknown) {
      setOverrides((prev) => removeOverrideRollback(prev, day, period));
      setError(errorOf(err));
    }
  }

  return {
    overrides,
    isOverridden: (day, period) => hasOverride(overrides, day, period),
    toggleBundle,
    error,
    clearError: () => {
      setError(null);
    },
  };
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : "Unexpected error persisting slot bundle";

const errorOf = (err: unknown): PlacementError => ({ kind: "message", message: messageOf(err) });
