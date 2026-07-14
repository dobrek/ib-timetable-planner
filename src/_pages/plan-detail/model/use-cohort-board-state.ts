import { useMemo } from "react";
import {
  assembleGeneratorSnapshot,
  buildCrossCohortIndex,
  type CohortSnapshotInput,
  type CrossCohortIndex,
  type GeneratedPlacement,
  type LocalPlacement,
  projectFromPlacements,
} from "@/entities/timetable";
import { deriveGenerationDeficits, verifyGeneration, type CellCollisions } from "@/entities/timetable";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { LocalParkedBundle } from "./placement/parked";
import { applyGeneratedPlacements } from "../api/placement-client";
import { buildGeneratedSegments, buildRegionPayload, generationHistoryEntry } from "./generation/apply-generated";
import { useGeneratePlan, type ApplyGeneratedResult, type GeneratePlanControls } from "./generation/use-generate-plan";
import { type LensCriterion } from "./lens";
import type { BoardSurface } from "../lib/board-surface";
import type { PlannerBoardProps, SharedBoardProps } from "./drag";
import { usePlacements, type UsePlacementsArgs } from "./use-placements";
import { useHistoryControls, useHistoryRecorder } from "./history/use-history";
import { useExplodedCells } from "./use-exploded-cells";
import {
  useAvailabilityIndex,
  useCatalogById,
  useCollisions,
  useDragHints,
  useDuplicateHighlight,
  useFinishesEarlySet,
  useHours,
  useLensMatches,
  useOptionalTally,
} from "./use-board-derivations";

/**
 * The combined view's two-cohort state orchestrator (S-06). It would be cleaner to call one
 * `useCohortBoardState` twice, but the **live cross-cohort index forms a cycle**: each cohort's
 * occupancy index is derived from the *other* column's live placements, so neither column's index
 * exists until both `usePlacements` instances do. This single hook resolves the cycle by sequencing
 * (the load-bearing Critical Implementation Detail):
 *   1. call `usePlacements` for BOTH cohorts, each fed the static SSR-seed index;
 *   2. `useMemo` each cohort's LIVE `CrossCohortIndex` from the OTHER's current placements;
 *   3. feed the FRESH index to each cohort's `useCollisions`/`useDragHints` (where validation and
 *      hints consume it) — so editing one column re-validates the other in the **same render**.
 * The SSR-seed index reaches only `duplicateBundle`'s cross-cohort term (the duplicate-target
 * search), which re-reads its own cohort's live `placementsRef` regardless; a session edit in the
 * sibling cohort isn't reflected in that one search, but the duplicate still lands and the fresh
 * index flags any resulting cross-cohort clash immediately — so it is unobservable. Render stays
 * pure (no refs read / no setState-in-effect — both forbidden by the React Compiler, which is enabled
 * in the build and so auto-memoizes this hook), which is why the `usePlacements` arg is the seed, not a
 * one-render-lagged live value.
 *
 * `focus` lets the hidden cohort idle in focus mode: when one cohort is hidden it is never edited and
 * never rendered, so its derivations are fed the static seed index instead of the visible cohort's
 * live placements — keeping its collision/drag-hint memos cached across edits (one fewer cohort-sized
 * pass per drop). Both cohorts still run unconditionally (constant hooks); only the index *input*
 * differs. `focus = "combined"` (the default) keeps BOTH indices live — today's two-cohort behavior.
 */
export function useCombinedBoardState(
  shared: SharedBoardProps,
  dp1Props: PlannerBoardProps,
  dp2Props: PlannerBoardProps,
  focus: BoardSurface = "combined",
  lensCriteria: LensCriterion[] = NO_LENS_CRITERIA,
) {
  // History recorder built FIRST: its stable `record` exists before either `usePlacements` runs, so
  // each cohort can receive it as `onRecord` (the upstream half of the ordering cycle).
  const { store, record } = useHistoryRecorder();

  // Static SSR-seed indices for `usePlacements` (duplicate-target search only). Built once.
  const dp1SeedIndex = useMemo(
    () => buildCrossCohortIndex(dp1Props.crossCohortOccupancy),
    [dp1Props.crossCohortOccupancy],
  );
  const dp2SeedIndex = useMemo(
    () => buildCrossCohortIndex(dp2Props.crossCohortOccupancy),
    [dp2Props.crossCohortOccupancy],
  );

  const dp1Base = useCohortPlacements(shared, dp1Props, dp1SeedIndex, (entry) => {
    record("dp1", entry);
  });
  const dp2Base = useCohortPlacements(shared, dp2Props, dp2SeedIndex, (entry) => {
    record("dp2", entry);
  });

  // Live cross-index: each cohort's occupancy from the OTHER column's current placements + catalog.
  // In focus mode the HIDDEN cohort idles on its static seed index (its output is unused and its own
  // placements never change), so its derivations stay cached across the visible cohort's edits; the
  // visible cohort keeps the live index (its hidden sibling is static, so that index is stable too).
  const dp1Hidden = focus === "dp2";
  const dp2Hidden = focus === "dp1";
  const dp1Index = useMemo(
    () => (dp1Hidden ? dp1SeedIndex : indexFromPlacements(dp2Base.api.placements, dp2Base.teacherKeysByCourseId)),
    [dp1Hidden, dp1SeedIndex, dp2Base.api.placements, dp2Base.teacherKeysByCourseId],
  );
  const dp2Index = useMemo(
    () => (dp2Hidden ? dp2SeedIndex : indexFromPlacements(dp1Base.api.placements, dp1Base.teacherKeysByCourseId)),
    [dp2Hidden, dp2SeedIndex, dp1Base.api.placements, dp1Base.teacherKeysByCourseId],
  );

  const dp1Deriv = useCohortDerivations(dp1Props, dp1Base, dp1Index, lensCriteria);
  const dp2Deriv = useCohortDerivations(dp2Props, dp2Base, dp2Index, lensCriteria);

  // History controls bound LAST: `undo`/`redo` need each cohort's reconcile/snapshot/busy, which
  // only exist now that both bases have run (the downstream half of the ordering cycle).
  const history = useHistoryControls(store, { dp1: dp1Base.api, dp2: dp2Base.api });

  // The generation apply verb (Phase 3 machinery; Phase 4's hook drives it): stage both cohorts
  // optimistically, ONE plan-scoped atomic RPC carrying both cohorts' regions, settle from the
  // returned rows, and record ONE two-cohort history entry (single undo press reverts both).
  // Records via `store.push` directly (the forward path records on settled success — the
  // recorder-bypass invariant concerns `applyReconcile`, which this never calls). Staged rows are
  // `pending`, so both cohorts' `busy` gate undo/redo and drag writes while the RPC is in flight.
  const bases = { dp1: dp1Base, dp2: dp2Base };
  async function applyGenerated(generated: GeneratedPlacement[]): Promise<ApplyGeneratedResult> {
    const segments = buildGeneratedSegments(
      generated,
      (cohort, scope) => bases[cohort].api.snapshot(scope),
      () => crypto.randomUUID(),
    );
    if (segments.length === 0) return { ok: true };
    // Apply-time re-verify: the engine judged its result against the CLICK-time snapshot, but the
    // board stays editable through the ~20 s solve. Re-judge the generated rows against the LIVE
    // board (read via refs, not the click-time closure) so a concurrent edit can't commit a board
    // the oracle never saw — the same clean-board guarantee the block-until-clean gate enforces at
    // click. `liveState()` and each segment's `snapshot(scope)` read the same refs in this one
    // synchronous pass, so the captured `before` slices and this judgment agree.
    const liveSnapshot = assembleGeneratorSnapshot(shared, {
      dp1: toSnapshotInput(dp1Props.catalog, dp1Base.api.liveState()),
      dp2: toSnapshotInput(dp2Props.catalog, dp2Base.api.liveState()),
    });
    if (!verifyGeneration(liveSnapshot, generated).ok) return { ok: false, reason: "stale" };
    for (const segment of segments) bases[segment.cohort].api.stageGenerated(segment.entries);
    try {
      const result = await applyGeneratedPlacements({ planId: shared.planId, ...buildRegionPayload(segments) });
      for (const segment of segments)
        bases[segment.cohort].api.settleGenerated(segment.entries, result[segment.cohort]);
      const entry = generationHistoryEntry(segments);
      if (entry) store.push(entry);
      return { ok: true };
    } catch (err: unknown) {
      for (const segment of segments) bases[segment.cohort].api.failGenerated(segment.entries, err);
      return { ok: false };
    }
  }

  // The Generate orchestration (Phase 4): snapshot assembly captures the LIVE combined state at
  // click time; the disabled inputs derive from the existing collision severities and the Phase 1
  // deficits — no new derivation passes (warns never block, per the block-until-clean decision).
  const combinedBusy = dp1Base.api.busy || dp2Base.api.busy;
  const dp1Deficits = useMemo(
    () =>
      deriveGenerationDeficits(dp1Base.api.placements, dp1Props.catalog, parkedCourseIds(dp1Base.api.parkedBundles)),
    [dp1Base.api.placements, dp1Props.catalog, dp1Base.api.parkedBundles],
  );
  const dp2Deficits = useMemo(
    () =>
      deriveGenerationDeficits(dp2Base.api.placements, dp2Props.catalog, parkedCourseIds(dp2Base.api.parkedBundles)),
    [dp2Base.api.placements, dp2Props.catalog, dp2Base.api.parkedBundles],
  );
  const disabledReason: GenerationDisabledReason =
    hasBlocking(dp1Deriv.collisions) || hasBlocking(dp2Deriv.collisions)
      ? "violations"
      : dp1Deficits.length === 0 && dp2Deficits.length === 0
        ? "complete"
        : null;
  const generateControls = useGeneratePlan({
    assemble: () =>
      assembleGeneratorSnapshot(shared, {
        dp1: toSnapshotInput(dp1Props.catalog, dp1Base.api),
        dp2: toSnapshotInput(dp2Props.catalog, dp2Base.api),
      }),
    applyGenerated,
    busy: combinedBusy,
    dp1Placements: dp1Base.api.placements,
    dp2Placements: dp2Base.api.placements,
  });

  return {
    dp1: toCohortState(dp1Props, dp1Base, dp1Deriv),
    dp2: toCohortState(dp2Props, dp2Base, dp2Deriv),
    history,
    applyGenerated,
    generation: { ...generateControls, disabledReason, busy: combinedBusy },
  };
}

/** Why Generate is disabled: blocking violations on either cohort, or nothing left to place. */
export type GenerationDisabledReason = "violations" | "complete" | null;

export type GenerationControls = GeneratePlanControls & {
  disabledReason: GenerationDisabledReason;
  /** True while other board writes are unsettled — the button also disables then. */
  busy: boolean;
};

const hasBlocking = (collisions: Map<string, CellCollisions>): boolean =>
  [...collisions.values()].some((cell) => cell.blockingIds.size > 0);

const parkedCourseIds = (bundles: { members: { courseId: string }[] }[]): string[] =>
  bundles.flatMap((bundle) => bundle.members.map((member) => member.courseId));

/** Adapt one cohort's board state to the entity-level snapshot input: placements go in verbatim
 *  (the assembly strips their local markers), parked bundles flatten to the course-id multiset. */
const toSnapshotInput = (
  catalog: GroupingCourse[],
  state: { placements: LocalPlacement[]; parkedBundles: LocalParkedBundle[] },
): CohortSnapshotInput => ({
  courses: catalog,
  placements: state.placements,
  parkedCourseIds: parkedCourseIds(state.parkedBundles),
});

export type CombinedBoardState = ReturnType<typeof useCombinedBoardState>;
export type CohortBoardState = CombinedBoardState["dp1"];
export type CohortActions = CohortBoardState["actions"];

/**
 * The per-cohort board-state assembler: the `useCohortPlacements` → `useCohortDerivations` →
 * `toCohortState` pipeline `useCombinedBoardState` runs per column, exposed as a one-shot seam.
 * `seedIndex` feeds `usePlacements` (the duplicate-target search only); `freshIndex` feeds the
 * collision/drag-hint derivations — pass the same static index as BOTH for a sibling-free assembly.
 *
 * Now that the board always runs the combined orchestrator (the single board is a focus mode), this
 * wrapper is exercised by `use-cohort-board-state.test.ts` as the per-cohort pipeline guard: the
 * `not.toBe` fresh-identity test pins the live cross-index cycle the combined path relies on (each
 * cohort's fresh index needs the OTHER's placements, which don't exist until both `usePlacements`
 * run — see `useCombinedBoardState`, which therefore cannot call this twice and composes directly).
 */
export function useCohortBoardState(
  shared: SharedBoardProps,
  props: PlannerBoardProps,
  seedIndex: CrossCohortIndex,
  freshIndex: CrossCohortIndex,
): CohortBoardState {
  const base = useCohortPlacements(shared, props, seedIndex);
  const deriv = useCohortDerivations(props, base, freshIndex);
  return toCohortState(props, base, deriv);
}

/**
 * Build one cohort's live cross-cohort occupancy index from the OTHER column's current placements +
 * its teacher map. Exported as the named seam of the live cross-index: editing one cohort's
 * placements yields a fresh index reflecting the change (see `use-cohort-board-state.test.ts`).
 */
export const indexFromPlacements = (
  placements: LocalPlacement[],
  teacherKeysByCourseId: Map<string, string[]>,
): CrossCohortIndex =>
  buildCrossCohortIndex(
    projectFromPlacements(
      placements.map((placement) => ({
        courseId: placement.courseId,
        day: placement.day,
        period: placement.period,
        week: placement.week,
      })),
      teacherKeysByCourseId,
    ),
  );

// Placement state + the per-cohort index inputs, fed a one-render-lagged cross-index (only
// `duplicateBundle` reads it). Split from the derivations so both `usePlacements` calls land before
// either fresh index is built (the live-index cycle — see `useCombinedBoardState`).
function useCohortPlacements(
  shared: SharedBoardProps,
  props: PlannerBoardProps,
  laggedIndex: CrossCohortIndex,
  onRecord?: UsePlacementsArgs["onRecord"],
) {
  const { planId, days, periods, availability } = shared;
  const { cohort, catalog } = props;
  const weekModeByCourseId = useMemo(
    () => new Map(catalog.map((course) => [course.id, course.weekMode] as const)),
    [catalog],
  );
  const teacherKeysByCourseId = useMemo(
    () => new Map(catalog.map((course) => [course.id, course.teacherKeys] as const)),
    [catalog],
  );
  const catalogById = useCatalogById(catalog);
  const availabilityIndex = useAvailabilityIndex(availability);
  // Plan-scoped flagged-id Set (both cohorts) — drives the edge rule at the committed board, the
  // drag what-if, and the auto-duplicate search. Each is a subset lookup against this cohort's ids.
  const finishesEarlySet = useFinishesEarlySet(shared.finishesEarlyByCourseId);
  const api = usePlacements(props.placements, {
    planId,
    cohort,
    weekModeByCourseId,
    catalogById,
    availabilityIndex,
    crossCohortIndex: laggedIndex,
    finishesEarlyByCourseId: finishesEarlySet,
    days,
    periods,
    initialParked: props.parkedBundles,
    onRecord,
  });
  return { api, catalogById, availabilityIndex, finishesEarlySet, periods, weekModeByCourseId, teacherKeysByCourseId };
}

// The pure derivations over one cohort's placements, fed the FRESH cross-index so cross-cohort
// validation and drag hints reflect the sibling column's current edits in the same render.
function useCohortDerivations(
  props: PlannerBoardProps,
  base: ReturnType<typeof useCohortPlacements>,
  freshIndex: CrossCohortIndex,
  lensCriteria: LensCriterion[] = NO_LENS_CRITERIA,
) {
  const placements = base.api.placements;
  const collisions = useCollisions(
    placements,
    base.catalogById,
    base.availabilityIndex,
    freshIndex,
    base.finishesEarlySet,
  );
  const { hours, unplaced, overplaced, hoursLeft, hoursOver } = useHours(placements, props.catalog);
  const { optionalByCourse, optionalCount } = useOptionalTally(placements);
  const { dropHints, startDragHints, clearDragHints } = useDragHints(
    base.catalogById,
    placements,
    props.groupings,
    base.availabilityIndex,
    freshIndex,
    base.finishesEarlySet,
    base.periods,
  );
  const { isExploded, toggleExploded } = useExplodedCells();
  const justDuplicated = useDuplicateHighlight(base.api.lastDuplicated);
  const lensMatches = useLensMatches(placements, base.catalogById, lensCriteria);
  return {
    collisions,
    lensMatches,
    hours,
    unplaced,
    overplaced,
    hoursLeft,
    hoursOver,
    optionalByCourse,
    optionalCount,
    dropHints,
    startDragHints,
    clearDragHints,
    isExploded,
    toggleExploded,
    justDuplicated,
  };
}

// Flatten one cohort's placement + derivation state into the public board-state shape the shell
// fans out to the grid, palette, and shelf. Pure (no hooks) — safe to call per cohort in render.
const toCohortState = (
  props: PlannerBoardProps,
  base: ReturnType<typeof useCohortPlacements>,
  deriv: ReturnType<typeof useCohortDerivations>,
) => ({
  cohort: props.cohort,
  groupings: props.groupings,
  courseDisplay: props.courseDisplay,
  stale: props.stale,
  hours: deriv.hours,
  unplaced: deriv.unplaced,
  overplaced: deriv.overplaced,
  hoursLeft: deriv.hoursLeft,
  hoursOver: deriv.hoursOver,
  optionalByCourse: deriv.optionalByCourse,
  optionalCount: deriv.optionalCount,
  placements: base.api.placements,
  parkedBundles: base.api.parkedBundles,
  collisions: deriv.collisions,
  lensMatches: deriv.lensMatches,
  dropHints: deriv.dropHints,
  isExploded: deriv.isExploded,
  toggleExploded: deriv.toggleExploded,
  justDuplicated: deriv.justDuplicated,
  startDragHints: deriv.startDragHints,
  clearDragHints: deriv.clearDragHints,
  error: base.api.error,
  clearError: base.api.clearError,
  weekModeByCourseId: base.weekModeByCourseId,
  actions: {
    addCourse: base.api.addCourse,
    addGroup: base.api.addGroup,
    movePlacement: base.api.movePlacement,
    removePlacement: base.api.removePlacement,
    setWeek: base.api.setWeek,
    setOptional: base.api.setOptional,
    moveBundle: base.api.moveBundle,
    removeBundle: base.api.removeBundle,
    duplicateBundle: base.api.duplicateBundle,
    shelveBundle: base.api.shelveBundle,
    placeBack: base.api.placeBack,
    parkMembers: base.api.parkMembers,
    removeParked: base.api.removeParked,
  },
});

// Stable no-criteria default so the lens memo's `criteria` dep never churns while the lens is off
// (a literal `[]` default would be a fresh identity per render).
const NO_LENS_CRITERIA: LensCriterion[] = [];
