import { useEffect, useMemo, useRef, useState } from "react";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { makeRpcs } from "../api/rpcs";
import type { AvailabilityIndex, CrossCohortIndex, LocalPlacement, PlannerPlacement } from "@/entities/timetable";
import type { CellData } from "./drag";
import type { GroupingCourse } from "./grouping/grouping";
import { errorOf, type PlacementError } from "./placement/placement-transitions";
import type { LocalParkedBundle, ParkedBundle, ParkedMember } from "./placement/parked";
import { createBoardWrites, type DuplicateOutcome } from "./placement/board-writes";
import { createShelfWrites } from "./placement/shelf-writes";
import type { WriteContext } from "./placement/write-context";
import { sliceAt } from "./history/affected-slice";
import {
  reconcilePlacementsOptimistic,
  rollbackReconcilePlacements,
  settleReconcilePlacements,
  type PlaceEntry,
} from "./history/reconcile-apply";
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
  /** Flagged-id set so the auto-duplicate search honors the early-finish edge rule. */
  finishesEarlyByCourseId: Set<string>;
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
  setOptional: (placementId: string, isOptional: boolean) => void;
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
  /** Read the live full board + shelf state (both refs), so an apply-time re-verify can't commit a
   *  board the oracle never judged. Currently has NO caller — the client-side generation apply path
   *  was deleted with `clean-up-bench-generation`; kept, with `stage/settle/failGenerated` below, for
   *  a future client-side apply (S-306). */
  liveState: () => { placements: LocalPlacement[]; parkedBundles: LocalParkedBundle[] };
  /** Drive both stores to a target slice over the existing RPCs, NON-recording (undo/redo executor). */
  applyReconcile: (target: AffectedSlice, scope: AffectedScope) => Promise<{ ok: boolean }>;
  /** Stage a verified generated batch optimistically (multi-cell, pending temps); a caller owns the
   *  flow — one plan-scoped RPC, then settle/fail. Currently has NO caller (see `liveState`). */
  stageGenerated: (entries: PlaceEntry[]) => void;
  /** Swap staged temps for their server rows (business-key match) and clear any stale banner. */
  settleGenerated: (entries: PlaceEntry[], rows: PlannerPlacement[]) => void;
  /** Drop the staged temps and surface the failure through the existing error banner. */
  failGenerated: (entries: PlaceEntry[], err: unknown) => void;
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
    finishesEarlyByCourseId,
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

  // The forward board (placement-store) write path — add/move/remove/setWeek/duplicate + the whole-slot
  // verbs. `weekModeOf` and the duplicate-search oracle inputs ride in `boardDeps` (board-only, not in
  // the shared `ctx`). Same async-callback ref contract as the shelf factory above.
  // eslint-disable-next-line react-hooks/refs -- refs are read in async callbacks, not during render
  const board = createBoardWrites(ctx, {
    catalogById,
    availabilityIndex,
    crossCohortIndex,
    finishesEarlyByCourseId,
    days,
    periods,
    weekModeOf,
    setLastDuplicated,
  });

  // Busy while any optimistic edit (a `pending` row in either store) or a reconcile is in flight.
  // The orchestrator gates undo/redo on this so a rapid ⌘Z mid-settle can't pop a not-yet-recorded
  // edit or read a one-render-lagged ref.
  const busy = reconciling || placements.some((p) => p.pending) || parkedBundles.some((c) => c.pending);

  // Read the live affected slice — used to capture `before` at edit time and the forward (redo)
  // target at undo time. Reads the latest refs (fresh across gestures), never inside a setState updater.
  function snapshot(scope: AffectedScope): AffectedSlice {
    return sliceAt(placementsRef.current, parkedBundlesRef.current, scope);
  }

  // Read the live full board + shelf state (both refs) for an apply-time re-verify — same ref-read
  // contract as `snapshot`: only ever from an async apply path, never during render. No caller today.
  function liveState(): { placements: LocalPlacement[]; parkedBundles: LocalParkedBundle[] } {
    return { placements: placementsRef.current, parkedBundles: parkedBundlesRef.current };
  }

  return {
    placements,
    error,
    lastDuplicated,
    ...board,
    parkedBundles,
    ...shelf,
    snapshot,
    liveState,
    applyReconcile,
    // The generated-batch staging primitives, built on the reconcile-apply transitions so the
    // multi-cell optimistic pass, settle, and rollback each land in ONE state update (no-flicker).
    // Staged rows are `pending`, so `busy` gates undo/redo and drag writes for free mid-apply.
    stageGenerated: (entries) => {
      setPlacements((prev) => reconcilePlacementsOptimistic(prev, [], entries));
    },
    settleGenerated: (entries, rows) => {
      setPlacements((prev) => settleReconcilePlacements(prev, entries, rows));
      setError(null);
    },
    failGenerated: (entries, err) => {
      setPlacements((prev) => rollbackReconcilePlacements(prev, entries, []));
      setError(errorOf(err));
    },
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
