import { useEffect, useMemo, useRef, useState } from "react";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { makeRpcs } from "../api/rpcs";
import type { AvailabilityIndex } from "./cross-cohort/availability-index";
import type { CrossCohortIndex } from "./cross-cohort/cross-cohort-index";
import type { CellData } from "./drag";
import { findDuplicateTarget } from "./placement/duplicate-target";
import type { GroupingCourse } from "./grouping/grouping";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  errorOf,
  groupFailureError,
  messageOf,
  moveIntent,
  moveManyOptimistic,
  moveManyRollback,
  occupantsAt,
  oppositeWeekAssignment,
  outcomesByCourse,
  partitionBundleMove,
  removeManyOptimistic,
  removeManyRollback,
  removeTarget,
  resolveDropWeek,
  setWeekOptimistic,
  setWeekReconcile,
  setWeekRollback,
  settleMany,
  type MemberOutcome,
  type PlacementError,
} from "./placement/placement-transitions";
import type { LocalParkedBundle, ParkedBundle, ParkedMember } from "./placement/parked";
import type { LocalPlacement, PlannerPlacement } from "./placement/placement";
import { createShelfWrites } from "./placement/shelf-writes";
import { cellScope, type WriteContext } from "./placement/write-context";
import { cellKey } from "./collision/cell-key";
import { sliceAt } from "./history/affected-slice";
import { useReconcileExecutor } from "./history/use-reconcile-executor";
import { describeEdit, type EditKind } from "./history/history-label";
import type { AffectedScope, AffectedSlice, HistoryEntry } from "./history/history-entry";

export type UsePlacementsArgs = {
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
  /**
   * Records a settled user edit for undo/redo. The orchestrator tags the `cohort`; this hook
   * supplies the `before` slice + scope + label. Fired only on settled success, never on rollback,
   * and never from `applyReconcile` (the recorder-bypass invariant is structural, not a flag).
   */
  onRecord?: (entry: Omit<HistoryEntry, "cohort">) => void;
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
    opts?: { oppositeWeek?: boolean; weekByMember?: Map<string, PlacementWeek>; editKind?: EditKind },
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
  /** Read the live affected slice at a scope — the orchestrator's forward (redo) target capture. */
  snapshot: (scope: AffectedScope) => AffectedSlice;
  /** Drive both stores to a target slice over the existing RPCs, NON-recording (undo/redo executor). */
  applyReconcile: (target: AffectedSlice, scope: AffectedScope) => Promise<{ ok: boolean }>;
  /** True while any optimistic edit or reconcile is in flight — gates undo/redo against the ref-lag window. */
  busy: boolean;
  clearError: () => void;
};

/**
 * Owns island-local placement state and the optimistic write path. Guards and state
 * transitions live in `placement-transitions.ts`; this hook orchestrates React state and
 * async persistence over those pure functions.
 *
 * The React Compiler is enabled in the build, so it auto-memoizes this hook's handlers — which is why
 * render must stay pure and refs are only ever read inside async callbacks (see the `useLatest`
 * footgun note), never during render.
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
    onRecord,
  }: UsePlacementsArgs,
): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [parkedBundles, setParkedBundles] = useState<LocalParkedBundle[]>(initialParked);
  // KNOWN LIMIT: a single last-writer-wins error slot. The forward write path is NOT serialized (only
  // undo/redo is, via `inFlightRef` in `use-history.ts`), so two near-simultaneous failures collapse to
  // the later one's banner. A success clears it (clear-on-success below); acceptable for one-banner UX.
  const [error, setError] = useState<PlacementError | null>(null);
  const [lastDuplicated, setLastDuplicated] = useState<DuplicateOutcome | null>(null);
  const placementsRef = useLatest(placements);
  const parkedBundlesRef = useLatest(parkedBundles);

  // `planId`/`cohort` bound once: the forward `persist*` path and the reconcile `deps` both call
  // through this instead of re-spelling them at every RPC site.
  const rpcs = useMemo(() => makeRpcs(planId, cohort), [planId, cohort]);

  const recordEdit = (kind: EditKind, scope: AffectedScope, before: AffectedSlice, cell?: CellData) => {
    onRecord?.({ scope, target: before, label: describeEdit(kind, cell) });
  };

  // The single injected context the executor and (soon) the forward writer factories all consume. It
  // is a superset of the executor's deps (adds `recordEdit`); the executor's narrower param type still
  // only sees its subset, so it structurally cannot record — the recorder-bypass invariant is type-level.
  const ctx: WriteContext = {
    rpcs,
    placementsRef,
    parkedBundlesRef,
    setPlacements,
    setParkedBundles,
    setError,
    recordEdit,
    snapshot,
  };

  // The undo/redo reconcile machinery lives in its own hook; the two stores stay unified here and are
  // injected by ref + setter. It reads only its subset of `ctx` (no `recordEdit`).
  const { applyReconcile, reconciling } = useReconcileExecutor(ctx);

  // The forward shelf (parked-store) write path — both two-store atomic verbs (shelve/place-back)
  // and the shelf-only ones (park/discard), driven off the same `ctx`. The factory reads `ctx`'s refs
  // ONLY inside its async persisters (never during render) — the same contract the executor relies on;
  // the lint rule exempts only `use*` hooks, so disable it for this plain-factory call.
  // eslint-disable-next-line react-hooks/refs -- refs are read in async callbacks, not during render
  const shelf = createShelfWrites(ctx);

  const weekModeOf = (courseId: string): WeekMode => weekModeByCourseId.get(courseId) ?? "agnostic";

  // Busy while any optimistic edit (a `pending` row in either store) or a reconcile is in flight.
  // The orchestrator gates undo/redo on this so a rapid ⌘Z mid-settle can't pop a not-yet-recorded
  // edit or read a one-render-lagged ref.
  const busy = reconciling || placements.some((p) => p.pending) || parkedBundles.some((c) => c.pending);

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

  // The missing third whole-slot verb. Reads the source cell's occupants (and their weeks),
  // runs the pure conflict-free search (a COPY context — the source stays on the board), and
  // either fans the member-set out at the target with the source weeks mirrored or sets the
  // message error. On dispatch it publishes the target (fresh nonce) so the board pulses it —
  // optimistically, before the fan-out settles (a fully-failed copy briefly pulses the emptied cell).
  function duplicateBundle(day: number, period: number) {
    const occupants = occupantsAt(placementsRef.current, { day, period });
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
    void persistAddGroup(
      placeable.map((p) => p.courseId),
      target,
      false,
      weekByMember,
      "duplicate",
    );
    setLastDuplicated((prev) => ({ ...target, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const courseIdsAt = (day: number, period: number): string[] =>
    occupantsAt(placementsRef.current, { day, period }).map((p) => p.courseId);

  async function persistAdd(courseId: string, cell: CellData) {
    if (!canAdd(placementsRef.current, courseId, cell)) return;

    const scope = cellScope(cell);
    // KNOWN LIMIT: `before` is read from the live refs, which lag the prior edit's optimistic `setState`
    // by one commit (see `useLatest`). Back-to-back same-cell gestures rely on commit timing being
    // faster than the gesture; the forward path is not busy-gated (only undo/redo is).
    const before = snapshot(scope);
    const week = resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);
    const tempId = crypto.randomUUID();
    setPlacements((prev) => addOptimistic(prev, tempId, courseId, cell, week));

    try {
      const row = await rpcs.placeCourse({ courseId, day: cell.day, period: cell.period, week });
      setPlacements((prev) => addReconcile(prev, tempId, row));
      recordEdit("add", scope, before, cell);
      setError(null); // a fully-successful settle dismisses any stale banner from a prior failure
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
    editKind: EditKind = "addGroup",
  ) {
    const eligible = eligibleMembers(placementsRef.current, memberIds, cell);
    if (eligible.length === 0) return;

    const scope = cellScope(cell);
    const before = snapshot(scope);

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

      // Record once if at least one member landed (a fully-failed batch leaves the cell unchanged).
      if (outcomes.some(({ result }) => result !== null)) recordEdit(editKind, scope, before, cell);

      // Clear a stale banner on a successful settle BEFORE the partial-failure setError below — so a
      // real groupFailure still surfaces. The obvious "clear at the very end" ordering would wipe it.
      setError(null);
      const failure = groupFailureError(outcomes, outcomes.length);
      if (failure) setError(failure);
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
  ): Promise<MemberOutcome> {
    try {
      const row = await rpcs.placeCourse({ courseId, day: cell.day, period: cell.period, week });
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
    const occupants = occupantsAt(placementsRef.current, source).filter((p) => courseSet.has(p.courseId));
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of moveIntent's pending reject

    const { movers, mergers } = partitionBundleMove(
      placementsRef.current,
      occupants.map((p) => p.id),
      target,
    );
    const moverRows = occupants.filter((p) => movers.includes(p.id));

    const scope: AffectedScope = {
      cells: [cellKey(source.day, source.period), cellKey(target.day, target.period)],
      cardSets: [],
    };
    const before = snapshot(scope);

    setPlacements((prev) => moveManyOptimistic(prev, movers, mergers, target));

    try {
      const serverRows = await rpcs.moveBundleMembers({
        day: source.day,
        period: source.period,
        courseIds,
        targetDay: target.day,
        targetPeriod: target.period,
      });
      // Reconcile each mover by course → its server row (relocation preserves the placement id,
      // so settleMany matches by the unchanged id and picks up the settled bundleId).
      const outcomes = outcomesByCourse(
        moverRows.map((row) => ({ tempId: row.id, courseId: row.courseId })),
        serverRows,
      );
      setPlacements((prev) => settleMany(prev, outcomes));

      recordEdit(courseIds.length > 1 ? "moveBundle" : "move", scope, before, target);

      setError(null); // clear before the partial-failure setError so a real groupFailure still surfaces
      const failure = groupFailureError(outcomes, moverRows.length);
      if (failure) setError(failure);
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
    const occupants = occupantsAt(placementsRef.current, cell).filter((p) => courseSet.has(p.courseId));
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of removeTarget's pending reject

    const scope = cellScope(cell);
    const before = snapshot(scope);

    setPlacements((prev) =>
      removeManyOptimistic(
        prev,
        occupants.map((p) => p.id),
      ),
    );

    try {
      await rpcs.removeBundleMembers({ day: cell.day, period: cell.period, courseIds });
      recordEdit(courseIds.length > 1 ? "removeBundle" : "remove", scope, before, cell);
      setError(null);
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
    const cell: CellData = { day: row.day, period: row.period };
    const scope = cellScope(cell);
    const before = snapshot(scope);

    setPlacements((prev) => setWeekOptimistic(prev, placementId, week));

    try {
      const updated = await rpcs.updatePlacementWeek(placementId, week);
      setPlacements((prev) => setWeekReconcile(prev, placementId, updated));
      recordEdit("setWeek", scope, before, cell);
      setError(null);
    } catch (err: unknown) {
      setPlacements((prev) => setWeekRollback(prev, placementId, prevWeek));
      setError(errorOf(err));
    }
  }

  // Read the live affected slice — used to capture `before` at edit time and the forward (redo)
  // target at undo time. Reads the latest refs (fresh across gestures), never inside a setState updater.
  function snapshot(scope: AffectedScope): AffectedSlice {
    return sliceAt(placementsRef.current, parkedBundlesRef.current, scope);
  }

  return {
    placements,
    error,
    lastDuplicated,
    addCourse: (courseId, cell) => void persistAdd(courseId, cell),
    addGroup: (memberIds, cell, opts) =>
      void persistAddGroup(
        memberIds,
        cell,
        opts?.oppositeWeek ?? false,
        opts?.weekByMember,
        opts?.editKind ?? "addGroup",
      ),
    movePlacement,
    removePlacement,
    setWeek: (placementId, week) => void persistSetWeek(placementId, week),
    moveBundle: (day, period, target) => void persistMoveMembers({ day, period }, courseIdsAt(day, period), target),
    removeBundle: (day, period) => void persistRemoveMembers({ day, period }, courseIdsAt(day, period)),
    duplicateBundle,
    parkedBundles,
    ...shelf,
    snapshot,
    applyReconcile,
    busy,
    clearError: () => {
      setError(null);
    },
  };
}

// FOOTGUN: the ref is written in a `useEffect`, so `ref.current` reflects the LAST COMMITTED render —
// it lags a `setState` issued earlier in the same tick by one commit. Every `persist*` dodges this by
// capturing what it needs (`occupants`, `moverRows`, `before`, `removedRows`) BEFORE the `await` and
// driving state through functional updaters. Rule: never read this ref expecting an in-tick `setState`
// to be reflected; capture up front and use functional `setState` instead.
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
