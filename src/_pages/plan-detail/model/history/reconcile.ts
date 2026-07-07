import type { ParkedMember } from "../placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";
import { memberSetKey, placementBusinessKey } from "./affected-slice";
import type { AffectedSlice, PlacementKey, ReconcilePlan } from "./history-entry";

/**
 * Compute the minimal RPC plan that drives the live affected slice (`current`) to a `target`
 * slice, operation-agnostically. Board rows are diffed by their business key
 * `(courseId, day, period, week, isOptional)`: anything in `current` but not `target` is removed;
 * anything in `target` but not `current` is placed. So a move = remove@source + place@target, a
 * week-flip = remove@oldWeek + place@newWeek (an optional-flip decomposes the same way), a
 * merge-undo = places at both cells, a no-op = empty plan.
 * Shelf cards are diffed as a multiset over member-sets → `cardsToDelete` / `cardsToCreate`.
 *
 * Removes precede places (and card-deletes precede card-creates) at execution time so a re-place
 * never collides with a row the same plan is about to delete (the one-placed-bundle-per-cell index).
 */
export function diffReconcile(current: AffectedSlice, target: AffectedSlice): ReconcilePlan {
  const currentKeys = new Set(current.placements.map(placementBusinessKey));
  const targetKeys = new Set(target.placements.map(placementBusinessKey));

  const toRemove = current.placements.filter((row) => !targetKeys.has(placementBusinessKey(row))).map(toPlacementKey);
  const toPlace = target.placements.filter((row) => !currentKeys.has(placementBusinessKey(row))).map(toPlacementKey);

  const cardsToDelete = multisetDifference(current.cards, target.cards);
  const cardsToCreate = multisetDifference(target.cards, current.cards);

  return { toRemove, toPlace, cardsToDelete, cardsToCreate };
}

const toPlacementKey = ({ courseId, day, period, week, isOptional }: PlannerPlacement): PlacementKey => ({
  courseId,
  day,
  period,
  week,
  isOptional,
});

/** The member-sets in `minuend` not matched one-for-one by an equal member-set in `subtrahend`. */
const multisetDifference = (minuend: ParkedMember[][], subtrahend: ParkedMember[][]): ParkedMember[][] => {
  const available = new Map<string, number>();
  for (const set of subtrahend) {
    const key = memberSetKey(set);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  return minuend.filter((set) => {
    const key = memberSetKey(set);
    const remaining = available.get(key) ?? 0;
    if (remaining === 0) return true;
    available.set(key, remaining - 1);
    return false;
  });
};
