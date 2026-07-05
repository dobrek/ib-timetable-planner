import { useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Rpcs } from "../../api/rpcs";
import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import type { LocalPlacement } from "@/entities/timetable";
import { errorOf, type PlacementError } from "../placement/placement-transitions";
import { memberSetKey, placementBusinessKey } from "./affected-slice";
import type { AffectedScope, AffectedSlice } from "./history-entry";
import { diffReconcile } from "./reconcile";
import { executeReconcilePlan, type ReconcileDeps } from "./reconcile-exec";
import {
  reconcileCardsOptimistic,
  reconcilePlacementsOptimistic,
  rollbackReconcileCards,
  rollbackReconcilePlacements,
  settleReconcileCards,
  settleReconcilePlacements,
  type CardEntry,
  type PlaceEntry,
} from "./reconcile-apply";

/** Everything the executor reads/writes in the parent's two stores, injected so the stores stay unified. */
type ReconcileExecutorDeps = {
  /** Read the live affected slice — the parent owns it (the forward path uses it on every edit). */
  snapshot: (scope: AffectedScope) => AffectedSlice;
  placementsRef: RefObject<LocalPlacement[]>;
  parkedBundlesRef: RefObject<LocalParkedBundle[]>;
  setPlacements: Dispatch<SetStateAction<LocalPlacement[]>>;
  setParkedBundles: Dispatch<SetStateAction<LocalParkedBundle[]>>;
  setError: Dispatch<SetStateAction<PlacementError | null>>;
  rpcs: Rpcs;
};

export type ReconcileExecutor = {
  /** Drive both stores to a target slice over the existing RPCs, NON-recording (undo/redo executor). */
  applyReconcile: (target: AffectedSlice, scope: AffectedScope) => Promise<{ ok: boolean }>;
  /** True while a reconcile is in flight — the parent composes it into `busy`. */
  reconciling: boolean;
};

/**
 * The undo/redo reconcile executor, lifted out of `usePlacements` so the hook reads as the forward
 * write path. The fracture line is clean: the two stores stay unified in the parent and are passed in
 * by ref + setter, while all the reconcile-only machinery (`diffReconcile`, `executeReconcilePlan`,
 * the `reconcile-apply` transitions, the card-matcher) lives here. This hook owns the `reconciling`
 * flag and returns it so the parent's `busy` stays composed (`reconciling` PLUS the stores' pending
 * rows). By construction it has no `recordEdit` path — the recorder-bypass invariant is structural.
 */
export function useReconcileExecutor({
  snapshot,
  placementsRef,
  parkedBundlesRef,
  setPlacements,
  setParkedBundles,
  setError,
  rpcs,
}: ReconcileExecutorDeps): ReconcileExecutor {
  const [reconciling, setReconciling] = useState(false);

  // Computes the diff from the live slice to a target, applies it to both stores in one pass each
  // (no-flicker), runs the plan over the existing RPCs (atomic compound where the shape allows,
  // decomposed only for the merge-undo residual), settles ids by business key, and on failure rolls
  // both stores back + surfaces the error.
  async function applyReconcile(target: AffectedSlice, scope: AffectedScope): Promise<{ ok: boolean }> {
    const plan = diffReconcile(snapshot(scope), target);

    // Capture — synchronously, before any optimistic mutation — the live rows the diff touches, so
    // rollback restores them faithfully and card ids resolve without depending on the lagged refs.
    const removeKeys = new Set(plan.toRemove.map(placementBusinessKey));
    const removedRows = placementsRef.current.filter((row) => removeKeys.has(placementBusinessKey(row)));
    const deletedCards = matchCardsByMemberSet(parkedBundlesRef.current, plan.cardsToDelete);
    const cardIdByMemberSet = new Map(deletedCards.map((card) => [memberSetKey(card.members), card.id]));

    const placeEntries: PlaceEntry[] = plan.toPlace.map((spec) => ({ tempId: crypto.randomUUID(), spec }));
    const cardEntries: CardEntry[] = plan.cardsToCreate.map((members) => ({ tempId: crypto.randomUUID(), members }));

    setReconciling(true);
    setPlacements((prev) => reconcilePlacementsOptimistic(prev, plan.toRemove, placeEntries));
    setParkedBundles((prev) =>
      reconcileCardsOptimistic(
        prev,
        deletedCards.map((card) => card.id),
        cardEntries,
      ),
    );

    const deps: ReconcileDeps = {
      moveMembers: (sourceCell, targetCell, courseIds) =>
        rpcs.moveBundleMembers({
          day: sourceCell.day,
          period: sourceCell.period,
          courseIds,
          targetDay: targetCell.day,
          targetPeriod: targetCell.period,
        }),
      shelve: (cell) => rpcs.shelveBundle({ day: cell.day, period: cell.period }),
      unshelve: (shelfBundleId, targetCell) =>
        rpcs.unshelveBundle({ shelfBundleId, targetDay: targetCell.day, targetPeriod: targetCell.period }),
      place: (spec) =>
        rpcs.placeCourse({ courseId: spec.courseId, day: spec.day, period: spec.period, week: spec.week }),
      removeMembers: (cell, courseIds) => rpcs.removeBundleMembers({ day: cell.day, period: cell.period, courseIds }),
      createCard: (members) => rpcs.shelveCourses({ members }),
      deleteCard: (shelfBundleId) => rpcs.deleteShelfBundle({ shelfBundleId }),
      // resolveCardId stays a local closure over `cardIdByMemberSet` (captured at call time) — it is
      // not an RPC, so it cannot bind into `rpcs`.
      resolveCardId: (members) => cardIdByMemberSet.get(memberSetKey(members)),
    };

    try {
      const result = await executeReconcilePlan(plan, deps);
      setPlacements((prev) => settleReconcilePlacements(prev, placeEntries, result.placed));
      setParkedBundles((prev) => settleReconcileCards(prev, cardEntries, result.createdCards));
      setError(null); // a fully-successful reconcile dismisses any stale banner, like the forward persist* paths
      return { ok: true };
    } catch (err: unknown) {
      setPlacements((prev) => rollbackReconcilePlacements(prev, placeEntries, removedRows));
      setParkedBundles((prev) => rollbackReconcileCards(prev, cardEntries, deletedCards));
      setError(errorOf(err));
      return { ok: false };
    } finally {
      setReconciling(false);
    }
  }

  return { applyReconcile, reconciling };
}

/** The live cards matching a list of member-sets (multiset) — kept whole so rollback restores their ids. */
function matchCardsByMemberSet(live: LocalParkedBundle[], memberSets: ParkedMember[][]): LocalParkedBundle[] {
  const wanted = new Map<string, number>();
  for (const set of memberSets) {
    const key = memberSetKey(set);
    wanted.set(key, (wanted.get(key) ?? 0) + 1);
  }
  return live.filter((card) => {
    const key = memberSetKey(card.members);
    const remaining = wanted.get(key) ?? 0;
    if (remaining === 0) return false;
    wanted.set(key, remaining - 1);
    return true;
  });
}
