import { cellKey } from "../collision/cell-key";
import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import type { LocalPlacement, PlannerPlacement } from "../placement/placement";
import type { AffectedScope, AffectedSlice } from "./history-entry";

/**
 * Read the slice of board state at a scope — used both to capture the pre-edit `before` and to
 * capture the live forward (redo) target. Pure: returns the placements whose cell ∈ `scope.cells`
 * (stripped of the local-only `pending` flag to a clean `PlannerPlacement`) and the cards whose
 * member-set matches one of `scope.cardSets` as a multiset (order-free, count-respecting).
 */
export function sliceAt(placements: LocalPlacement[], cards: LocalParkedBundle[], scope: AffectedScope): AffectedSlice {
  const cellSet = new Set(scope.cells);
  const slicePlacements = placements
    .filter((placement) => cellSet.has(cellKey(placement.day, placement.period)))
    .map(toPlannerPlacement);

  const wanted = countByMemberSet(scope.cardSets);
  const sliceCards = cards.filter((card) => consume(wanted, memberSetKey(card.members))).map((card) => card.members);

  return { placements: slicePlacements, cards: sliceCards };
}

const toPlannerPlacement = ({ id, courseId, day, period, week, bundleId }: LocalPlacement): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  ...(bundleId !== undefined ? { bundleId } : {}),
});

/** Canonical, order-free key for a member-set so two formations with the same `{course, week}` pairs match. */
export const memberSetKey = (members: ParkedMember[]): string =>
  members
    .map((member) => `${member.courseId}:${member.week}`)
    .sort()
    .join("|");

const countByMemberSet = (sets: ParkedMember[][]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const set of sets) {
    const key = memberSetKey(set);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** Decrement the available count for `key`; return true (and consume one) iff a match was available. */
const consume = (counts: Map<string, number>, key: string): boolean => {
  const remaining = counts.get(key) ?? 0;
  if (remaining === 0) return false;
  counts.set(key, remaining - 1);
  return true;
};
