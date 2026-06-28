import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import type { LocalPlacement } from "../placement/placement";
import { memberSetKey } from "./affected-slice";
import type { PlacementKey, PlacementSpec } from "./history-entry";
import type { ReconcileResult } from "./reconcile-exec";

// Pure single-pass transitions that drive both island stores to a reconcile target and settle/roll
// back the result — the optimistic side of `applyReconcile`. Each runs in ONE `setPlacements` /
// `setParkedBundles` pass so collisions/hours re-derive once (the no-flicker invariant). Framework
// free and unit-testable, mirroring `placement-transitions.ts` / `shelf-transitions.ts`.

/** A target placement staged behind a temp id until its server row settles by business key. */
export type PlaceEntry = { tempId: string; spec: PlacementSpec };
/** A target card staged behind a temp id until its server id settles by member-set. */
export type CardEntry = { tempId: string; members: ParkedMember[] };

/** Apply the board diff in one pass: drop the keyed removes, append the places as pending temps. */
export function reconcilePlacementsOptimistic(
  prev: LocalPlacement[],
  toRemove: PlacementKey[],
  placeEntries: PlaceEntry[],
): LocalPlacement[] {
  const removeKeys = new Set(toRemove.map(businessKey));
  const kept = prev.filter((row) => !removeKeys.has(businessKey(row)));
  const added = placeEntries.map(({ tempId, spec }): LocalPlacement => ({ id: tempId, ...spec, pending: true }));
  return [...kept, ...added];
}

/** Apply the shelf diff in one pass: drop the deleted cards by id, append the creates as pending temps. */
export function reconcileCardsOptimistic(
  prev: LocalParkedBundle[],
  deleteCardIds: string[],
  cardEntries: CardEntry[],
): LocalParkedBundle[] {
  const removeIds = new Set(deleteCardIds);
  const kept = prev.filter((card) => !removeIds.has(card.id));
  const added = cardEntries.map(({ tempId, members }): LocalParkedBundle => ({ id: tempId, members, pending: true }));
  return [...kept, ...added];
}

/** Settle placed temps to their server rows by course id (drop any the RPC did not return). */
export function settleReconcilePlacements(
  prev: LocalPlacement[],
  placeEntries: PlaceEntry[],
  placed: ReconcileResult["placed"],
): LocalPlacement[] {
  const serverByCourse = new Map(placed.map((row) => [row.courseId, row]));
  const tempBySpec = new Map(placeEntries.map(({ tempId, spec }) => [tempId, spec]));
  return prev.flatMap((row) => {
    const spec = tempBySpec.get(row.id);
    if (!spec) return [row];
    const server = serverByCourse.get(spec.courseId);
    return server ? [server] : [];
  });
}

/** Settle created card temps to their server ids by member-set. */
export function settleReconcileCards(
  prev: LocalParkedBundle[],
  cardEntries: CardEntry[],
  createdCards: ReconcileResult["createdCards"],
): LocalParkedBundle[] {
  const serverByMembers = new Map(createdCards.map((card) => [memberSetKey(card.members), card.id]));
  const tempIds = new Set(cardEntries.map((entry) => entry.tempId));
  return prev.map((card) => {
    if (!tempIds.has(card.id)) return card;
    const serverId = serverByMembers.get(memberSetKey(card.members));
    return serverId ? { id: serverId, members: card.members } : card;
  });
}

/** Roll the board back after a failed reconcile: drop the optimistic places, restore the removed rows. */
export function rollbackReconcilePlacements(
  prev: LocalPlacement[],
  placeEntries: PlaceEntry[],
  removedRows: LocalPlacement[],
): LocalPlacement[] {
  const tempIds = new Set(placeEntries.map((entry) => entry.tempId));
  return [...prev.filter((row) => !tempIds.has(row.id)), ...removedRows];
}

/** Roll the shelf back after a failed reconcile: drop the optimistic creates, restore the deleted cards. */
export function rollbackReconcileCards(
  prev: LocalParkedBundle[],
  cardEntries: CardEntry[],
  deletedCards: LocalParkedBundle[],
): LocalParkedBundle[] {
  const tempIds = new Set(cardEntries.map((entry) => entry.tempId));
  return [...prev.filter((card) => !tempIds.has(card.id)), ...deletedCards];
}

const businessKey = ({ courseId, day, period, week }: PlacementKey): string => `${courseId}|${day}|${period}|${week}`;
