import { cellKey, type LocalPlacement, type PlannerPlacement } from "@/entities/timetable";
import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import type { AffectedScope, AffectedSlice, PlacementKey } from "./history-entry";

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

const toPlannerPlacement = ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional,
  bundleId,
}: LocalPlacement): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional,
  ...(bundleId !== undefined ? { bundleId } : {}),
});

/**
 * Canonical business key for a placement — `${courseId}|${day}|${period}|${week}|${isOptional}`. The
 * one home for the reconcile-matching key the diff (`reconcile.ts`), the optimistic apply
 * (`reconcile-apply.ts`), and the executor all key on; they MUST agree, so they share this single
 * derivation rather than re-spelling it. `isOptional` is part of the key so a flag flip diffs to a
 * non-empty plan (undo of a mark/accept works) and a re-place restores the flag.
 */
export const placementBusinessKey = ({ courseId, day, period, week, isOptional }: PlacementKey): string =>
  `${courseId}|${day}|${period}|${week}|${isOptional}`;

/** Canonical, order-free key for a member-set so two formations with the same `{course, week, optional}` triples match. */
export const memberSetKey = (members: ParkedMember[]): string =>
  members
    .map((member) => `${member.courseId}:${member.week}:${member.isOptional}`)
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
