import { useMemo } from "react";
import { buildCrossCohortIndex, projectFromPlacements, type CrossCohortIndex } from "./cross-cohort/cross-cohort-index";
import type { PlannerBoardProps } from "./drag";
import type { LocalPlacement } from "./placement/placement";
import { usePlacements } from "./use-placements";
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
 * pure (no refs read / no setState-in-effect — the React Compiler forbids both), which is why the
 * `usePlacements` arg is the seed, not a one-render-lagged live value.
 */
export function useCombinedBoardState(dp1Props: PlannerBoardProps, dp2Props: PlannerBoardProps) {
  // Static SSR-seed indices for `usePlacements` (duplicate-target search only). Built once.
  const dp1SeedIndex = useMemo(
    () => buildCrossCohortIndex(dp1Props.crossCohortOccupancy),
    [dp1Props.crossCohortOccupancy],
  );
  const dp2SeedIndex = useMemo(
    () => buildCrossCohortIndex(dp2Props.crossCohortOccupancy),
    [dp2Props.crossCohortOccupancy],
  );

  const dp1Base = useCohortPlacements(dp1Props, dp1SeedIndex);
  const dp2Base = useCohortPlacements(dp2Props, dp2SeedIndex);

  // Live cross-index: each cohort's occupancy from the OTHER column's current placements + catalog.
  const dp1Index = useMemo(
    () => indexFromPlacements(dp2Base.api.placements, dp2Base.teacherKeysByCourseId),
    [dp2Base.api.placements, dp2Base.teacherKeysByCourseId],
  );
  const dp2Index = useMemo(
    () => indexFromPlacements(dp1Base.api.placements, dp1Base.teacherKeysByCourseId),
    [dp1Base.api.placements, dp1Base.teacherKeysByCourseId],
  );

  const dp1Deriv = useCohortDerivations(dp1Props, dp1Base, dp1Index);
  const dp2Deriv = useCohortDerivations(dp2Props, dp2Base, dp2Index);

  return {
    dp1: toCohortState(dp1Props, dp1Base, dp1Deriv),
    dp2: toCohortState(dp2Props, dp2Base, dp2Deriv),
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
  props: PlannerBoardProps,
  seedIndex: CrossCohortIndex,
  freshIndex: CrossCohortIndex,
): CohortBoardState {
  const base = useCohortPlacements(props, seedIndex);
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
function useCohortPlacements(props: PlannerBoardProps, laggedIndex: CrossCohortIndex) {
  const { planId, cohort, days, periods, catalog, availability } = props;
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
  const { hours, incompleteCount } = useHours(placements, props.catalog);
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
    incompleteCount,
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
  names: props.names,
  stale: props.stale,
  hours: deriv.hours,
  incompleteCount: deriv.incompleteCount,
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
