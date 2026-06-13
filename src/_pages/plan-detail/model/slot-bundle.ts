import { cellKey } from "./collisions";

/**
 * A persisted unbundled override, keyed by cell coordinate. Its presence means the
 * cell is explicitly **UNbundled** (opt-out / grouped-by-default — see the migration
 * and `api/slot-bundles.ts`). `isBundled = occupants >= 2 && !overridden`.
 */
export type SlotOverride = { day: number; period: number };

/** An override in island-local state. `pending` is true while an optimistic toggle is in flight. */
export type LocalSlotOverride = SlotOverride & { pending?: boolean };

/** Is `(day, period)` explicitly unbundled? Keyed via `cellKey`; ignores the pending flag. */
export function hasOverride(overrides: SlotOverride[], day: number, period: number): boolean {
  const key = cellKey(day, period);
  return overrides.some((override) => cellKey(override.day, override.period) === key);
}

/**
 * Grouped-by-default with opt-out: a cell is a bundle iff it has >=2 occupants and is
 * not explicitly overridden. A single-occupant cell is never a bundle.
 */
export function isBundled(occupantCount: number, overridden: boolean): boolean {
  return occupantCount >= 2 && !overridden;
}

// --- Optimistic override transitions (mirror the placement add/remove shape) ---

/** Ungroup optimistically: append a pending override for the cell. */
export function addOverrideOptimistic(prev: LocalSlotOverride[], day: number, period: number): LocalSlotOverride[] {
  return [...prev, { day, period, pending: true }];
}

/** Ungroup confirmed: clear the pending flag on the cell's override. */
export function addOverrideReconcile(prev: LocalSlotOverride[], day: number, period: number): LocalSlotOverride[] {
  const key = cellKey(day, period);
  return prev.map((override) =>
    cellKey(override.day, override.period) === key ? { day: override.day, period: override.period } : override,
  );
}

/** Ungroup failed: drop the optimistic override. */
export function addOverrideRollback(prev: LocalSlotOverride[], day: number, period: number): LocalSlotOverride[] {
  const key = cellKey(day, period);
  return prev.filter((override) => cellKey(override.day, override.period) !== key);
}

/** Regroup optimistically: remove the cell's override. */
export function removeOverrideOptimistic(prev: LocalSlotOverride[], day: number, period: number): LocalSlotOverride[] {
  const key = cellKey(day, period);
  return prev.filter((override) => cellKey(override.day, override.period) !== key);
}

/** Regroup failed: restore the removed override. */
export function removeOverrideRollback(prev: LocalSlotOverride[], day: number, period: number): LocalSlotOverride[] {
  return [...prev, { day, period }];
}
