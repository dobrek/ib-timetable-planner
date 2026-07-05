import { cellKey } from "@/entities/timetable";
import type { CellData } from "../drag";
import type { AffectedScope } from "../history/history-entry";
import type { ParkedMember } from "./parked";
import {
  addManyOptimistic,
  eligibleMembers,
  errorOf,
  groupFailureError,
  occupantsAt,
  outcomesByCourse,
  removeManyOptimistic,
  removeManyRollback,
  settleMany,
} from "./placement-transitions";
import {
  membersAtCell,
  parkAddOptimistic,
  parkReconcile,
  parkRollback,
  unparkOptimistic,
  unparkRollback,
} from "./shelf-transitions";
import type { WriteContext } from "./write-context";

export type ShelfWrites = {
  /** Lift the bundle at a cell off the board into the shelf (two-store atomic). */
  shelveBundle: (day: number, period: number) => void;
  /** Place a parked bundle's courses back at a target cell (merge if occupied; two-store atomic). */
  placeBack: (shelfBundleId: string, target: CellData) => void;
  /** Park an arbitrary course-set directly onto the shelf (e.g. a palette grouping) — shelf-store-only. */
  parkMembers: (members: ParkedMember[]) => void;
  /** Discard a parked card outright (the card's "×") — shelf-store-only. */
  removeParked: (shelfBundleId: string) => void;
};

/**
 * The shelf (parked-store) forward write path, lifted out of `usePlacements`. The two-store atomic
 * verbs (`shelveBundle`, `placeBack`) live here because the injected `WriteContext` carries BOTH
 * setters; `parkMembers` / `removeParked` are shelf-store-only. Behavior is byte-for-byte identical
 * to the inline persisters — same optimistic/rollback/two-store sequencing over the same `rpcs`.
 */
export function createShelfWrites(ctx: WriteContext): ShelfWrites {
  const { placementsRef, parkedBundlesRef, setPlacements, setParkedBundles, setError, rpcs, recordEdit, snapshot } =
    ctx;

  // Park: lift a cell's bundle off the board into the shelf in ONE two-store optimistic pass —
  // remove the board placements AND add a pending parked card carrying their (course, week) set.
  // One atomic `shelve_bundle` RPC; reconcile the card's temp id to the server shelf id. A failed
  // RPC rolls BOTH stores back (placements restored, pending card dropped).
  async function persistShelve(day: number, period: number) {
    const occupants = occupantsAt(placementsRef.current, { day, period });
    if (occupants.length === 0) return; // empty-cell no-op
    if (occupants.some((p) => p.pending)) return; // pending-source no-op (mirrors move/remove)

    const members = membersAtCell(placementsRef.current, day, period);
    const tempId = crypto.randomUUID();

    const scope: AffectedScope = { cells: [cellKey(day, period)], cardSets: [members] };
    const before = snapshot(scope);

    setPlacements((prev) =>
      removeManyOptimistic(
        prev,
        occupants.map((p) => p.id),
      ),
    );
    setParkedBundles((prev) => parkAddOptimistic(prev, tempId, members));

    try {
      const parked = await rpcs.shelveBundle({ day, period });
      setParkedBundles((prev) => parkReconcile(prev, tempId, parked.id));
      recordEdit("lift", scope, before, { day, period });
      setError(null);
    } catch (err: unknown) {
      setPlacements((prev) => removeManyRollback(prev, occupants));
      setParkedBundles((prev) => parkRollback(prev, tempId));
      setError(errorOf(err));
    }
  }

  // Park a course-set directly onto the shelf (no board placements involved) — the off-board
  // analogue of persistShelve, for a palette grouping that was never placed. Optimistic add of a
  // pending card, one atomic `shelve_courses` RPC, reconcile the temp id; a failure drops the card.
  // Dedup against an already-parked identical set is the caller's concern (it owns the notice).
  async function persistParkMembers(members: ParkedMember[]) {
    if (members.length === 0) return;
    const scope: AffectedScope = { cells: [], cardSets: [members] };
    const before = snapshot(scope);
    const tempId = crypto.randomUUID();
    setParkedBundles((prev) => parkAddOptimistic(prev, tempId, members));

    try {
      const parked = await rpcs.shelveCourses({ members });
      setParkedBundles((prev) => parkReconcile(prev, tempId, parked.id));
      recordEdit("parkMembers", scope, before);
      setError(null);
    } catch (err: unknown) {
      setParkedBundles((prev) => parkRollback(prev, tempId));
      setError(errorOf(err));
    }
  }

  // Place-back: drop a parked bundle's courses onto a target cell. Filter the members through
  // `eligibleMembers` FIRST so a course already present at an occupied target is left out of the
  // optimistic add (the merge case — `place_course` returns the existing row there, which can't
  // reconcile a duplicate temp chip). One atomic `unshelve_bundle` RPC still places ALL shelf
  // courses server-side (idempotent on the present one); the filter only governs the overlay.
  // Reconcile the temp placements by courseId (like persistMoveMembers). A failure rolls BOTH
  // stores back (card restored, temp placements dropped).
  async function persistPlaceBack(shelfBundleId: string, target: CellData) {
    const card = parkedBundlesRef.current.find((b) => b.id === shelfBundleId);
    if (!card || card.pending) return; // unknown / not-yet-reconciled card

    const scope: AffectedScope = { cells: [cellKey(target.day, target.period)], cardSets: [card.members] };
    const before = snapshot(scope);

    const weekByMember = new Map(card.members.map((m) => [m.courseId, m.week] as const));
    const eligible = eligibleMembers(
      placementsRef.current,
      card.members.map((m) => m.courseId),
      target,
    );
    const entries = eligible.map((courseId) => ({
      tempId: crypto.randomUUID(),
      courseId,
      week: weekByMember.get(courseId) ?? "both",
    }));

    setParkedBundles((prev) => unparkOptimistic(prev, shelfBundleId));
    setPlacements((prev) => addManyOptimistic(prev, entries, target));

    try {
      const serverRows = await rpcs.unshelveBundle({
        shelfBundleId,
        targetDay: target.day,
        targetPeriod: target.period,
      });
      // Match each temp placement to its server row by course (place_course preserves no temp id).
      const outcomes = outcomesByCourse(entries, serverRows);
      setPlacements((prev) => settleMany(prev, outcomes));

      recordEdit("placeBack", scope, before, target);

      setError(null); // clear before the partial-failure setError so a real groupFailure still surfaces
      const failure = groupFailureError(outcomes, entries.length);
      if (failure) setError(failure);
    } catch (err: unknown) {
      setParkedBundles((prev) => unparkRollback(prev, card));
      setPlacements((prev) =>
        settleMany(
          prev,
          entries.map(({ tempId }) => ({ tempId, result: null })),
        ),
      );
      setError(errorOf(err));
    }
  }

  // Discard a parked card outright (the card's "×"). Shelf-store-only — no board placements
  // involved, so no two-store coordination. Optimistic remove → one `delete_shelf_bundle` RPC;
  // a failure restores the card.
  async function persistRemoveParked(shelfBundleId: string) {
    const card = parkedBundlesRef.current.find((b) => b.id === shelfBundleId);
    if (!card || card.pending) return; // unknown / not-yet-reconciled card

    const scope: AffectedScope = { cells: [], cardSets: [card.members] };
    const before = snapshot(scope);

    setParkedBundles((prev) => unparkOptimistic(prev, shelfBundleId));

    try {
      await rpcs.deleteShelfBundle({ shelfBundleId });
      recordEdit("discard", scope, before);
      setError(null);
    } catch (err: unknown) {
      setParkedBundles((prev) => unparkRollback(prev, card));
      setError(errorOf(err));
    }
  }

  return {
    shelveBundle: (day, period) => void persistShelve(day, period),
    placeBack: (shelfBundleId, target) => void persistPlaceBack(shelfBundleId, target),
    parkMembers: (members) => void persistParkMembers(members),
    removeParked: (shelfBundleId) => void persistRemoveParked(shelfBundleId),
  };
}
