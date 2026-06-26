import { useEffect, useRef, useState } from "react";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { moveBundleMembers, placeCourse, removeBundleMembers, updatePlacementWeek } from "../api/placement-client";
import { deleteShelfBundle, shelveBundle as shelveBundleRpc, shelveCourses, unshelveBundle } from "../api/shelf-client";
import type { AvailabilityIndex } from "./availability-index";
import type { CrossCohortIndex } from "./cross-cohort-index";
import type { CellData } from "./drag";
import { findDuplicateTarget } from "./duplicate-target";
import type { GroupingCourse } from "./grouping";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  moveIntent,
  moveManyOptimistic,
  moveManyRollback,
  oppositeWeekAssignment,
  partitionBundleMove,
  removeManyOptimistic,
  removeManyRollback,
  removeTarget,
  resolveDropWeek,
  setWeekOptimistic,
  setWeekReconcile,
  setWeekRollback,
  settleMany,
  type BatchOutcome,
  type PlacementError,
} from "./placement-transitions";
import type { LocalParkedBundle, ParkedBundle, ParkedMember } from "./parked";
import {
  membersAtCell,
  parkAddOptimistic,
  parkReconcile,
  parkRollback,
  unparkOptimistic,
  unparkRollback,
} from "./shelf-transitions";
import type { LocalPlacement, PlannerPlacement } from "./placement";

type UsePlacementsArgs = {
  planId: string;
  cohort: Cohort;
  /** courseId → eligibility, so the drop path resolves a bi-weekly course to a concrete week. */
  weekModeByCourseId: Map<string, WeekMode>;
  /** Oracle inputs (already computed at the board) the duplicate search reuses. */
  catalogById: Map<string, GroupingCourse>;
  availabilityIndex: AvailabilityIndex;
  crossCohortIndex: CrossCohortIndex;
  days: number;
  periods: number;
  /** Server-durable parked bundles for this cohort, seeding the shelf store. */
  initialParked?: ParkedBundle[];
};

/** Transient outcome of a successful duplicate: the target cell, plus a nonce so a same-cell
 *  re-duplicate (impossible today, but cheap to guarantee) still re-fires the board's feedback. */
type DuplicateOutcome = CellData & { nonce: number };

type UsePlacements = {
  placements: LocalPlacement[];
  error: PlacementError | null;
  /** The most recent duplicate's landing cell (with a fresh nonce); null until the first duplicate. */
  lastDuplicated: DuplicateOutcome | null;
  addCourse: (courseId: string, cell: CellData) => void;
  addGroup: (
    memberIds: string[],
    cell: CellData,
    opts?: { oppositeWeek?: boolean; weekByMember?: Map<string, PlacementWeek> },
  ) => void;
  movePlacement: (placementId: string, cell: CellData) => void;
  removePlacement: (placementId: string) => void;
  setWeek: (placementId: string, week: PlacementWeek) => void;
  moveBundle: (day: number, period: number, target: CellData) => void;
  removeBundle: (day: number, period: number) => void;
  duplicateBundle: (day: number, period: number) => void;
  /** Parked (shelved) bundles in island-local state. */
  parkedBundles: LocalParkedBundle[];
  /** Lift the bundle at a cell off the board into the shelf (two-store atomic). */
  shelveBundle: (day: number, period: number) => void;
  /** Place a parked bundle's courses back at a target cell (merge if occupied; two-store atomic). */
  placeBack: (shelfBundleId: string, target: CellData) => void;
  /** Park an arbitrary course-set directly onto the shelf (e.g. a palette grouping) — shelf-store-only. */
  parkMembers: (members: ParkedMember[]) => void;
  /** Discard a parked card outright (the card's "×") — shelf-store-only. */
  removeParked: (shelfBundleId: string) => void;
  clearError: () => void;
};

/**
 * Owns island-local placement state and the optimistic write path. Guards and state
 * transitions live in `placement-transitions.ts`; this hook orchestrates React state and
 * async persistence over those pure functions.
 *
 * Every mutation is one transactional RPC over a member-set: `placeCourse` (add — one call
 * per member), `moveBundleMembers` (move/merge — single move and whole-bundle move are
 * M-of-one vs M-of-all), `removeBundleMembers` (remove). The board call sites stay ergonomic
 * (`addCourse`, `movePlacement`, `moveBundle`, …); each is a thin wrapper over the primitive.
 */
export function usePlacements(
  initial: PlannerPlacement[],
  {
    planId,
    cohort,
    weekModeByCourseId,
    catalogById,
    availabilityIndex,
    crossCohortIndex,
    days,
    periods,
    initialParked = [],
  }: UsePlacementsArgs,
): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [parkedBundles, setParkedBundles] = useState<LocalParkedBundle[]>(initialParked);
  const [error, setError] = useState<PlacementError | null>(null);
  const [lastDuplicated, setLastDuplicated] = useState<DuplicateOutcome | null>(null);
  const placementsRef = useLatest(placements);
  const parkedBundlesRef = useLatest(parkedBundles);

  const weekModeOf = (courseId: string): WeekMode => weekModeByCourseId.get(courseId) ?? "agnostic";

  function addCourse(courseId: string, cell: CellData) {
    void persistAdd(courseId, cell);
  }

  function addGroup(
    memberIds: string[],
    cell: CellData,
    opts?: { oppositeWeek?: boolean; weekByMember?: Map<string, PlacementWeek> },
  ) {
    void persistAddGroup(memberIds, cell, opts?.oppositeWeek ?? false, opts?.weekByMember);
  }

  function movePlacement(placementId: string, cell: CellData) {
    const result = moveIntent(placementsRef.current, placementId, cell);
    if (!result.ok) return; // not-found / pending / same-cell / occupied (own twin)
    const { value: intent } = result;
    void persistMoveMembers(intent.origin, [intent.courseId], cell);
  }

  function removePlacement(placementId: string) {
    const result = removeTarget(placementsRef.current, placementId);
    if (!result.ok) return; // not-found / pending
    const { value: row } = result;
    void persistRemoveMembers({ day: row.day, period: row.period }, [row.courseId]);
  }

  function setWeek(placementId: string, week: PlacementWeek) {
    void persistSetWeek(placementId, week);
  }

  function moveBundle(day: number, period: number, target: CellData) {
    void persistMoveMembers({ day, period }, courseIdsAt(day, period), target);
  }

  function removeBundle(day: number, period: number) {
    void persistRemoveMembers({ day, period }, courseIdsAt(day, period));
  }

  // The missing third whole-slot verb. Reads the source cell's occupants (and their weeks),
  // runs the pure conflict-free search (a COPY context — the source stays on the board), and
  // either fans the member-set out at the target with the source weeks mirrored or sets the
  // message error. On dispatch it publishes the target (fresh nonce) so the board pulses it —
  // optimistically, before the fan-out settles (a fully-failed copy briefly pulses the emptied cell).
  function duplicateBundle(day: number, period: number) {
    const occupants = placementsRef.current.filter((p) => p.day === day && p.period === period);
    if (occupants.length === 0) return; // empty-source no-op
    if (occupants.some((p) => p.pending)) return; // pending-source no-op (mirrors move/remove)

    // Only occupants resolvable in the validation catalog can be searched + placed.
    const placeable = occupants.filter((p) => catalogById.has(p.courseId));
    if (placeable.length === 0) return;
    const members = placeable
      .map((p) => catalogById.get(p.courseId))
      .filter((course): course is GroupingCourse => course !== undefined);

    const target = findDuplicateTarget({
      source: { day, period },
      members,
      placements: placementsRef.current,
      catalogById,
      availability: availabilityIndex,
      occupiedByTeacher: crossCohortIndex,
      days,
      periods,
    });
    if (!target) {
      setError({ kind: "message", message: "No empty slot available to duplicate into" });
      return;
    }

    // Mirror the source's exact A/B layout — carry each member's week explicitly so the fan-out
    // does not re-resolve it (which could swap A/B between members for a bi-weekly pair).
    const weekByMember = new Map(placeable.map((p) => [p.courseId, p.week] as const));
    addGroup(
      placeable.map((p) => p.courseId),
      target,
      { weekByMember },
    );
    setLastDuplicated((prev) => ({ ...target, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const courseIdsAt = (day: number, period: number): string[] =>
    placementsRef.current.filter((p) => p.day === day && p.period === period).map((p) => p.courseId);

  function shelveBundle(day: number, period: number) {
    void persistShelve(day, period);
  }

  function placeBack(shelfBundleId: string, target: CellData) {
    void persistPlaceBack(shelfBundleId, target);
  }

  function parkMembers(members: ParkedMember[]) {
    void persistParkMembers(members);
  }

  function removeParked(shelfBundleId: string) {
    void persistRemoveParked(shelfBundleId);
  }

  async function persistAdd(courseId: string, cell: CellData) {
    if (!canAdd(placementsRef.current, courseId, cell)) return;

    const week = resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);
    const tempId = crypto.randomUUID();
    setPlacements((prev) => addOptimistic(prev, tempId, courseId, cell, week));

    try {
      const row = await placeCourse({ planId, cohort, courseId, day: cell.day, period: cell.period, week });
      setPlacements((prev) => addReconcile(prev, tempId, row));
    } catch (err: unknown) {
      setPlacements((prev) => addRollback(prev, tempId));
      setError(errorOf(err));
    }
  }

  // Group fan-out: one idempotent place_course per eligible member. They share the cell's
  // bundle (find-or-create), members already in the cell are skipped, and the optimistic batch
  // and settlement each land in one state update so collision/hours derivations recompute once.
  async function persistAddGroup(
    memberIds: string[],
    cell: CellData,
    oppositeWeek: boolean,
    weekByMember?: Map<string, PlacementWeek>,
  ) {
    const eligible = eligibleMembers(placementsRef.current, memberIds, cell);
    if (eligible.length === 0) return;

    // Week precedence: an explicit per-member week (a duplicate mirroring the source's A/B layout)
    // wins; else an opposite-week grouping alternates a/b; else each member resolves by its own
    // eligibility (agnostic ⇒ both, bi-weekly ⇒ first free week).
    const oppositeWeekByMember = oppositeWeek ? oppositeWeekAssignment(eligible) : null;
    const weekFor = (courseId: string): PlacementWeek =>
      weekByMember?.get(courseId) ??
      oppositeWeekByMember?.get(courseId) ??
      resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);

    const entries = eligible.map((courseId) => ({ tempId: crypto.randomUUID(), courseId, week: weekFor(courseId) }));
    setPlacements((prev) => addManyOptimistic(prev, entries, cell));

    try {
      const outcomes = await Promise.all(entries.map((entry) => persistMember(entry, cell)));
      setPlacements((prev) => settleMany(prev, outcomes));

      const failedCourseIds = outcomes.filter(({ result }) => result === null).map(({ courseId }) => courseId);
      if (failedCourseIds.length > 0) setError({ kind: "groupFailure", failedCourseIds, attempted: outcomes.length });
    } catch (err: unknown) {
      setPlacements((prev) =>
        settleMany(
          prev,
          entries.map(({ tempId }) => ({ tempId, result: null })),
        ),
      );
      setError(errorOf(err));
    }
  }

  async function persistMember(
    { tempId, courseId, week }: { tempId: string; courseId: string; week: PlacementWeek },
    cell: CellData,
  ): Promise<BatchOutcome & { courseId: string }> {
    try {
      const row = await placeCourse({ planId, cohort, courseId, day: cell.day, period: cell.period, week });
      return { tempId, courseId, result: row };
    } catch (err: unknown) {
      // The banner names which members failed; keep the underlying reason traceable.
      // eslint-disable-next-line no-console
      console.error(`[persistAddGroup] place failed for course ${courseId}: ${messageOf(err)}`);
      return { tempId, courseId, result: null };
    }
  }

  // The unified member-set move (single move, whole-bundle move, merge). One optimistic
  // `moveManyOptimistic` pass (movers → target + pending; mergers filtered, never moved onto a
  // twin), one atomic `moveBundleMembers` RPC, one `settleMany` pass swapping the movers for the
  // server rows (id preserved on relocation). The board derives only the initial and final
  // states — never a transient duplicate. An atomic failure rolls the whole move back.
  async function persistMoveMembers(source: CellData, courseIds: string[], target: CellData) {
    if (target.day === source.day && target.period === source.period) return; // same-cell no-op
    const courseSet = new Set(courseIds);
    const occupants = placementsRef.current.filter(
      (p) => p.day === source.day && p.period === source.period && courseSet.has(p.courseId),
    );
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of moveIntent's pending reject

    const { movers, mergers } = partitionBundleMove(
      placementsRef.current,
      occupants.map((p) => p.id),
      target,
    );
    const moverRows = occupants.filter((p) => movers.includes(p.id));

    setPlacements((prev) => moveManyOptimistic(prev, movers, mergers, target));

    try {
      const serverRows = await moveBundleMembers({
        planId,
        cohort,
        day: source.day,
        period: source.period,
        courseIds,
        targetDay: target.day,
        targetPeriod: target.period,
      });
      // Reconcile each mover by course → its server row (relocation preserves the placement id,
      // so settleMany matches by the unchanged id and picks up the settled bundleId).
      const serverByCourse = new Map(serverRows.map((row) => [row.courseId, row]));
      const outcomes: (BatchOutcome & { courseId: string })[] = moverRows.map((row) => ({
        tempId: row.id,
        courseId: row.courseId,
        result: serverByCourse.get(row.courseId) ?? null,
      }));
      setPlacements((prev) => settleMany(prev, outcomes));

      const failedCourseIds = outcomes.filter(({ result }) => result === null).map(({ courseId }) => courseId);
      if (failedCourseIds.length > 0) setError({ kind: "groupFailure", failedCourseIds, attempted: moverRows.length });
    } catch (err: unknown) {
      setPlacements((prev) => moveManyRollback(prev, movers, occupants));
      setError(errorOf(err));
    }
  }

  // The unified member-set remove (single remove, whole-bundle remove). One optimistic pass,
  // one atomic `removeBundleMembers` RPC (which deletes the bundle at == 0 membership); a
  // failure restores the removed rows.
  async function persistRemoveMembers(cell: CellData, courseIds: string[]) {
    const courseSet = new Set(courseIds);
    const occupants = placementsRef.current.filter(
      (p) => p.day === cell.day && p.period === cell.period && courseSet.has(p.courseId),
    );
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of removeTarget's pending reject

    setPlacements((prev) =>
      removeManyOptimistic(
        prev,
        occupants.map((p) => p.id),
      ),
    );

    try {
      await removeBundleMembers({ planId, cohort, day: cell.day, period: cell.period, courseIds });
    } catch (err: unknown) {
      setPlacements((prev) => removeManyRollback(prev, occupants));
      setError(errorOf(err));
    }
  }

  // Flip a placed bi-weekly chip between the A and B lanes. Optimistic: set the new week,
  // persist via updatePlacementWeek, reconcile to the server row; on failure roll back the week.
  async function persistSetWeek(placementId: string, week: PlacementWeek) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending || row.week === week) return;
    const prevWeek = row.week;

    setPlacements((prev) => setWeekOptimistic(prev, placementId, week));

    try {
      const updated = await updatePlacementWeek(placementId, week);
      setPlacements((prev) => setWeekReconcile(prev, placementId, updated));
    } catch (err: unknown) {
      setPlacements((prev) => setWeekRollback(prev, placementId, prevWeek));
      setError(errorOf(err));
    }
  }

  // Park: lift a cell's bundle off the board into the shelf in ONE two-store optimistic pass —
  // remove the board placements AND add a pending parked card carrying their (course, week) set.
  // One atomic `shelve_bundle` RPC; reconcile the card's temp id to the server shelf id. A failed
  // RPC rolls BOTH stores back (placements restored, pending card dropped).
  async function persistShelve(day: number, period: number) {
    const occupants = placementsRef.current.filter((p) => p.day === day && p.period === period);
    if (occupants.length === 0) return; // empty-cell no-op
    if (occupants.some((p) => p.pending)) return; // pending-source no-op (mirrors move/remove)

    const members = membersAtCell(placementsRef.current, day, period);
    const tempId = crypto.randomUUID();

    setPlacements((prev) =>
      removeManyOptimistic(
        prev,
        occupants.map((p) => p.id),
      ),
    );
    setParkedBundles((prev) => parkAddOptimistic(prev, tempId, members));

    try {
      const parked = await shelveBundleRpc({ planId, cohort, day, period });
      setParkedBundles((prev) => parkReconcile(prev, tempId, parked.id));
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
    const tempId = crypto.randomUUID();
    setParkedBundles((prev) => parkAddOptimistic(prev, tempId, members));

    try {
      const parked = await shelveCourses({ planId, cohort, members });
      setParkedBundles((prev) => parkReconcile(prev, tempId, parked.id));
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
      const serverRows = await unshelveBundle({
        planId,
        cohort,
        shelfBundleId,
        targetDay: target.day,
        targetPeriod: target.period,
      });
      // Match each temp placement to its server row by course (place_course preserves no temp id).
      const serverByCourse = new Map(serverRows.map((row) => [row.courseId, row]));
      const outcomes: (BatchOutcome & { courseId: string })[] = entries.map((entry) => ({
        tempId: entry.tempId,
        courseId: entry.courseId,
        result: serverByCourse.get(entry.courseId) ?? null,
      }));
      setPlacements((prev) => settleMany(prev, outcomes));

      const failedCourseIds = outcomes.filter(({ result }) => result === null).map(({ courseId }) => courseId);
      if (failedCourseIds.length > 0) setError({ kind: "groupFailure", failedCourseIds, attempted: entries.length });
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

    setParkedBundles((prev) => unparkOptimistic(prev, shelfBundleId));

    try {
      await deleteShelfBundle({ planId, shelfBundleId });
    } catch (err: unknown) {
      setParkedBundles((prev) => unparkRollback(prev, card));
      setError(errorOf(err));
    }
  }

  return {
    placements,
    error,
    lastDuplicated,
    addCourse,
    addGroup,
    movePlacement,
    removePlacement,
    setWeek,
    moveBundle,
    removeBundle,
    duplicateBundle,
    parkedBundles,
    shelveBundle,
    placeBack,
    parkMembers,
    removeParked,
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
  err instanceof Error ? err.message : "Unexpected error persisting placement";

const errorOf = (err: unknown): PlacementError => ({ kind: "message", message: messageOf(err) });
