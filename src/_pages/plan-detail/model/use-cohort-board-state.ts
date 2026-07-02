import { useMemo } from "react";
import { buildCrossCohortIndex, projectFromPlacements, type CrossCohortIndex } from "./cross-cohort/cross-cohort-index";
import type { BoardSurface } from "../lib/board-surface";
import type { PlannerBoardProps, SharedBoardProps } from "./drag";
import type { LocalPlacement } from "./placement/placement";
import { usePlacements, type UsePlacementsArgs } from "./use-placements";
import { useHistoryControls, useHistoryRecorder } from "./history/use-history";
import { useExplodedCells } from "./use-exploded-cells";
import {
  useAvailabilityIndex,
  useCatalogById,
  useCollisions,
  useDragHints,
  useDuplicateHighlight,
  useHours,
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

  const dp1Deriv = useCohortDerivations(dp1Props, dp1Base, dp1Index);
  const dp2Deriv = useCohortDerivations(dp2Props, dp2Base, dp2Index);

  // History controls bound LAST: `undo`/`redo` need each cohort's reconcile/snapshot/busy, which
  // only exist now that both bases have run (the downstream half of the ordering cycle).
  const history = useHistoryControls(store, { dp1: dp1Base.api, dp2: dp2Base.api });

  return {
    dp1: toCohortState(dp1Props, dp1Base, dp1Deriv),
    dp2: toCohortState(dp2Props, dp2Base, dp2Deriv),
    history,
  };
}

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
  const api = usePlacements(props.placements, {
    planId,
    cohort,
    weekModeByCourseId,
    catalogById,
    availabilityIndex,
    crossCohortIndex: laggedIndex,
    days,
    periods,
    initialParked: props.parkedBundles,
    onRecord,
  });
  return { api, catalogById, availabilityIndex, weekModeByCourseId, teacherKeysByCourseId };
}

// The pure derivations over one cohort's placements, fed the FRESH cross-index so cross-cohort
// validation and drag hints reflect the sibling column's current edits in the same render.
function useCohortDerivations(
  props: PlannerBoardProps,
  base: ReturnType<typeof useCohortPlacements>,
  freshIndex: CrossCohortIndex,
) {
  const placements = base.api.placements;
  const collisions = useCollisions(placements, base.catalogById, base.availabilityIndex, freshIndex);
  const { hours, unplaced, overplaced, hoursLeft, hoursOver } = useHours(placements, props.catalog);
  const { dropHints, startDragHints, clearDragHints } = useDragHints(
    base.catalogById,
    placements,
    props.groupings,
    base.availabilityIndex,
    freshIndex,
  );
  const { isExploded, toggleExploded } = useExplodedCells();
  const justDuplicated = useDuplicateHighlight(base.api.lastDuplicated);
  return {
    collisions,
    hours,
    unplaced,
    overplaced,
    hoursLeft,
    hoursOver,
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
  placements: base.api.placements,
  parkedBundles: base.api.parkedBundles,
  collisions: deriv.collisions,
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
    moveBundle: base.api.moveBundle,
    removeBundle: base.api.removeBundle,
    duplicateBundle: base.api.duplicateBundle,
    shelveBundle: base.api.shelveBundle,
    placeBack: base.api.placeBack,
    parkMembers: base.api.parkMembers,
    removeParked: base.api.removeParked,
  },
});
