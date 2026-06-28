import { useMemo, useState } from "react";
import type { Cohort } from "@/shared/config";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import {
  BoardHeader,
  BoardShell,
  DragHintModeToggle,
  ErrorBanner,
  PlanSummaryBar,
  inspectedViolations,
  inspectedWeeks,
  useHintMode,
  usePaletteDisclosure,
  useShelfDisclosure,
} from "./chrome";
import { PlannerGrid, type PairedColumn } from "./grid";
import { CollisionDetailsDialog, type CollisionInspectionTarget, GroupDragOverlay } from "./overlay";
import { CombinedPalettePanel, ComputeGroupingsEmptyState, type PaletteCohortData } from "./palette";
import ShelfDrawer from "./shelf/ShelfDrawer";
import { cellKey } from "../model/collision/cell-key";
import { resolveCombinedDrop } from "../model/cross-cohort/drop-router";
import { applyDropAction } from "../model/cross-cohort/drop-dispatch";
import type { DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import { resolvePaletteView } from "../model/grouping/palette-view";
import { placementErrorMessage } from "../model/placement/placement-transitions";
import { useCombinedBoardState, type CohortBoardState } from "../model/use-cohort-board-state";
import type { BoardSurface } from "../lib/board-surface";

type Props = {
  planName: string;
  /** The active surface from `?focus=`: one cohort (focus mode) or the combined two-cohort board. */
  focus: BoardSurface;
  dp1: PlannerBoardProps;
  dp2: PlannerBoardProps;
  paletteCollapsed: boolean;
};

/**
 * The ONE plan-detail board. `useCombinedBoardState(dp1, dp2)` runs UNCONDITIONALLY in every mode
 * (constant hook count of 2 — the cross-index cycle is built for exactly 2 and keeps working); only
 * the *render* branches on `focus`. `focus = "combined"` renders both cohort columns with the
 * cohort-switcher palette + sibling-dim; `focus = "dp1"|"dp2"` renders one column, the palette locked
 * to that cohort, the shelf filtered to it, no sibling-dim, and a full-screen empty state. One
 * `DragDropProvider`, one drop router, one canonical `applyDropAction` dispatch.
 */
export default function PlannerBoard({ planName, focus, dp1: dp1Props, dp2: dp2Props, paletteCollapsed }: Props) {
  const { dp1, dp2 } = useCombinedBoardState(dp1Props, dp2Props);
  const byCohort: Record<Cohort, CohortBoardState> = { dp1, dp2 };
  const resolveState = (cohort: Cohort) => byCohort[cohort];

  const { hintMode, setHintMode } = useHintMode();
  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  // Honor the SSR palette-collapse cookie in every mode (focus + combined alike).
  const { collapsed: paletteCollapsedState, setCollapsed: setPaletteCollapsed } =
    usePaletteDisclosure(paletteCollapsed);
  // The palette's active cohort (combined only) doubles as the drag-target signal for a palette drag.
  const [paletteCohort, setPaletteCohort] = useState<Cohort>("dp1");
  // Source cohort of the active drag — drives the sibling-column dimming (combined only). Null between drags.
  const [activeDragCohort, setActiveDragCohort] = useState<Cohort | null>(null);
  // The shell owns the ONE active inspection across both columns: opening one closes the other.
  const [inspection, setInspection] = useState<{ cohort: Cohort; target: CollisionInspectionTarget } | null>(null);

  const combined = focus === "combined";
  // The cohort a cohort-free palette drag adopts (and the off-board park cohort): the palette's active
  // cohort in combined, the focused cohort in focus mode. The `focus === "combined"` discriminant (not
  // the `combined` alias) narrows `focus` to `Cohort` in the else branch — no non-null assertion.
  const activeCohort: Cohort = focus === "combined" ? paletteCohort : focus;

  const planId = dp1Props.planId;
  const days = dp1Props.days;
  const periods = dp1Props.periods;

  // Union course names for the shared overlay (teacher/student names are already the union from the
  // loader, identical on both props). A cross-cohort bundle/parked overlay can reference either set.
  const overlayNames = useMemo(() => ({ ...dp1.names, ...dp2.names }), [dp1.names, dp2.names]);

  // shelfBundleId → owning cohort. Combined maps BOTH cohorts (one shared shelf); focus maps only the
  // focused cohort (its shelf is filtered to it, so the parked-count badge matches the shelf cards).
  const shelfCohortById = useMemo(() => {
    if (focus === "combined") {
      return new Map<string, Cohort>([
        ...dp1.parkedBundles.map((bundle) => [bundle.id, "dp1"] as const),
        ...dp2.parkedBundles.map((bundle) => [bundle.id, "dp2"] as const),
      ]);
    }
    const bundles = focus === "dp1" ? dp1.parkedBundles : dp2.parkedBundles;
    return new Map<string, Cohort>(bundles.map((bundle) => [bundle.id, focus] as const));
  }, [focus, dp1.parkedBundles, dp2.parkedBundles]);

  // Close the dialog if the inspected cell's violations vanish in its cohort (adjust-state-during-render).
  if (
    inspection &&
    !byCohort[inspection.cohort].collisions.has(cellKey(inspection.target.day, inspection.target.period))
  )
    setInspection(null);

  function handleDragStart(event: DragStartEvent) {
    const data = event.operation.source?.data as DragData | undefined;
    if (!data) return;
    // A relocating drag carries its source cohort; a cohort-free palette drag targets `activeCohort`.
    const dragCohort = "cohort" in data ? data.cohort : activeCohort;
    byCohort[dragCohort].startDragHints(data);
    setActiveDragCohort(dragCohort);
  }

  function handleDrop(event: DragEndEvent) {
    dp1.clearDragHints();
    dp2.clearDragHints(); // a no-op for the hidden cohort in focus mode (it never started a drag)
    setActiveDragCohort(null);
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return; // dropped outside any cell — removal is via the chip "×"

    // One router resolves the target cohort + the cross-cohort guard; one dispatch applies it. A
    // cohort-free palette drag on the cell-less shelf parks under `activeCohort`.
    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData, activeCohort);
    if (action) applyDropAction(action, resolveState, { collapseUnlessPinned });
  }

  // Discard a parked card → route to its owning cohort's store (the card is tagged with its cohort).
  function removeParked(shelfBundleId: string) {
    const cohort = shelfCohortById.get(shelfBundleId);
    if (cohort) byCohort[cohort].actions.removeParked(shelfBundleId);
  }

  const paletteData = (state: CohortBoardState): PaletteCohortData => ({
    cohort: state.cohort,
    planId,
    groupings: state.groupings,
    names: state.names,
    hours: state.hours,
    stale: state.stale,
  });

  const buildColumn = (cohort: Cohort, state: CohortBoardState): PairedColumn => ({
    cohort,
    placements: state.placements,
    names: state.names,
    collisions: state.collisions,
    wiring: {
      dropHints: state.dropHints,
      hintMode,
      isExploded: state.isExploded,
      justDuplicated: state.justDuplicated,
      onRemove: state.actions.removePlacement,
      onSetWeek: state.actions.setWeek,
      onToggleBundle: state.toggleExploded,
      onRemoveBundle: state.actions.removeBundle,
      onDuplicateBundle: state.actions.duplicateBundle,
      onLiftBundle: (day, period) => {
        applyDropAction({ kind: "liftBundle", cohort, day, period }, resolveState, { collapseUnlessPinned });
      },
      onInspect: (target) => {
        setInspection({ cohort, target });
      },
    },
  });

  // Focus mode with no groupings → the single board's full-screen empty takeover (no grid/palette/shelf).
  // Combined keeps the in-panel empty body so the author can still switch cohorts when one is empty.
  if (focus !== "combined") {
    const state = byCohort[focus];
    if (resolvePaletteView({ groupingsCount: state.groupings.length, stale: state.stale }) === "empty") {
      return (
        <>
          <BoardHeader planName={planName} planId={planId} active={focus} />
          <div data-slot="planner-board" className="p-6">
            <ComputeGroupingsEmptyState planId={planId} cohort={focus} />
          </div>
        </>
      );
    }
  }

  const columns =
    focus === "combined" ? [buildColumn("dp1", dp1), buildColumn("dp2", dp2)] : [buildColumn(focus, byCohort[focus])];
  const cohorts = focus === "combined" ? [paletteData(dp1), paletteData(dp2)] : [paletteData(byCohort[focus])];
  const parkedBundles =
    focus === "combined" ? [...dp1.parkedBundles, ...dp2.parkedBundles] : byCohort[focus].parkedBundles;
  const incompleteCount =
    focus === "combined" ? dp1.incompleteCount + dp2.incompleteCount : byCohort[focus].incompleteCount;
  const inspected = inspection ? byCohort[inspection.cohort] : null;

  return (
    <BoardShell
      onDragStart={handleDragStart}
      onDragEnd={handleDrop}
      gridDataSlot="planner-board"
      header={
        <PlanSummaryBar
          planName={planName}
          incompleteCount={incompleteCount}
          parkedCount={parkedBundles.length}
          onExpandShelf={() => {
            setExpanded(true);
          }}
          planId={planId}
          active={focus}
          trailing={<DragHintModeToggle mode={hintMode} onChange={setHintMode} />}
        />
      }
      palette={
        <CombinedPalettePanel
          cohorts={cohorts}
          activeCohort={activeCohort}
          onActiveCohortChange={combined ? setPaletteCohort : undefined}
          collapsed={paletteCollapsedState}
          onCollapsedChange={setPaletteCollapsed}
        />
      }
      center={
        <div className="flex min-h-0 flex-col gap-3">
          {dp1.error && (
            <ErrorBanner message={placementErrorMessage(dp1.error, dp1.names)} onDismiss={dp1.clearError} />
          )}
          {dp2.error && (
            <ErrorBanner message={placementErrorMessage(dp2.error, dp2.names)} onDismiss={dp2.clearError} />
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <PlannerGrid
              days={days}
              periods={periods}
              gridLabel={`${planName} timetable`}
              columns={columns}
              activeDragCohort={combined ? activeDragCohort : null}
            />
          </div>
        </div>
      }
      shelf={
        <ShelfDrawer
          parkedBundles={parkedBundles}
          names={focus === "combined" ? overlayNames : byCohort[focus].names}
          expanded={shelfExpanded}
          pinned={pinned}
          cohortById={shelfCohortById}
          onExpandedChange={setExpanded}
          onPinnedChange={setPinned}
          onRemoveParked={removeParked}
        />
      }
      dialog={
        <CollisionDetailsDialog
          target={inspection?.target ?? null}
          violations={inspection && inspected ? inspectedViolations(inspection.target, inspected.collisions) : []}
          names={inspected?.names ?? overlayNames}
          teacherNames={dp1Props.teacherNames}
          studentNames={dp1Props.studentNames}
          weekByCourseId={inspection && inspected ? inspectedWeeks(inspection.target, inspected.placements) : {}}
          cohort={inspection?.cohort ?? "dp1"}
          onClose={() => {
            setInspection(null);
          }}
        />
      }
      overlay={
        <GroupDragOverlay
          groupings={[...dp1.groupings, ...dp2.groupings]}
          names={overlayNames}
          placements={[...dp1.placements, ...dp2.placements]}
          parkedBundles={[...dp1.parkedBundles, ...dp2.parkedBundles]}
          placementsByCohort={{ dp1: dp1.placements, dp2: dp2.placements }}
        />
      }
    />
  );
}
