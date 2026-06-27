import type { LocalParkedBundle, ParkedMember } from "./parked";
import type { LocalPlacement } from "./placement";

// Pure, immutable transitions for the parked-list side of park / place-back / discard —
// the shelf analogue of `placement-transitions.ts`. The two-store atomic update (board +
// shelf) is composed one level up in `use-placements.ts`, which drives these alongside the
// placement transitions in a single optimistic pass. Keeping them pure makes the cross-store
// update unit-testable without React.

// --- Park (board → shelf) ---

/** Append a pending parked card carrying the lifted cell's members (with their A/B weeks). */
export function parkAddOptimistic(
  prev: LocalParkedBundle[],
  tempId: string,
  members: ParkedMember[],
): LocalParkedBundle[] {
  return [...prev, { id: tempId, members, pending: true }];
}

/** Swap the optimistic temp id for the server's shelf id and clear `pending`. */
export function parkReconcile(prev: LocalParkedBundle[], tempId: string, serverId: string): LocalParkedBundle[] {
  return prev.map((card) => (card.id === tempId ? { id: serverId, members: card.members } : card));
}

/** Drop the pending card after a failed park. */
export function parkRollback(prev: LocalParkedBundle[], tempId: string): LocalParkedBundle[] {
  return prev.filter((card) => card.id !== tempId);
}

// --- Unpark (shelf → board, or discard) ---

/** Remove a parked card by id — the optimistic side of place-back AND discard (same shape). */
export function unparkOptimistic(prev: LocalParkedBundle[], shelfBundleId: string): LocalParkedBundle[] {
  return prev.filter((card) => card.id !== shelfBundleId);
}

/** Restore a removed card after a failed place-back or discard. */
export function unparkRollback(prev: LocalParkedBundle[], removed: LocalParkedBundle): LocalParkedBundle[] {
  return [...prev, removed];
}

// --- Source read (the park source) ---

/** Read a cell's occupant `{courseId, week}` set — the membership captured when lifting it. */
export function membersAtCell(placements: LocalPlacement[], day: number, period: number): ParkedMember[] {
  return placements
    .filter((placement) => placement.day === day && placement.period === period)
    .map((placement) => ({ courseId: placement.courseId, week: placement.week }));
}
