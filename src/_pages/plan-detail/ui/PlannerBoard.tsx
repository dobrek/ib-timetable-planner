import { useMemo } from "react";
import { cohortLabel, type Cohort } from "@/shared/config";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import {
  BoardHeader,
  BoardShell,
  DragHintModeToggle,
  ErrorBanner,
  PlanSummaryBar,
  inspectedViolations,
  inspectedWeeks,
  useCollisionInspection,
  useHintMode,
  usePaletteDisclosure,
  useShelfDisclosure,
} from "./chrome";
import { PlannerGrid, useCellWiring } from "./grid";
import { CollisionDetailsDialog, GroupDragOverlay } from "./overlay";
import { ComputeGroupingsEmptyState, PlannerPalette } from "./palette";
import ShelfDrawer from "./shelf/ShelfDrawer";
import type { DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import { resolveCombinedDrop } from "../model/cross-cohort/drop-router";
import { applyDropAction } from "../model/cross-cohort/drop-dispatch";
import { resolvePaletteView } from "../model/grouping/palette-view";
import { useCrossCohortIndex } from "../model/use-board-derivations";
import { useCohortBoardState } from "../model/use-cohort-board-state";
import { placementErrorMessage } from "../model/placement/placement-transitions";

/**
 * Planner island root: orchestrates placement state, collision/hours derivations,
 * and the palette/grid views. Drops always land (accept-and-flag); the only way to
 * remove a course is the chip's "×".
 */
export default function PlannerBoard({
  planName,
  paletteCollapsed,
  ...props
}: PlannerBoardProps & { planName: string; paletteCollapsed: boolean }) {
  const { planId, cohort, days, periods, groupings, stale, names, teacherNames, studentNames } = props;

  // The single board has no live cross-cohort sibling, so it feeds its ONE static SSR index as BOTH
  // the seed (usePlacements' duplicate-target search) and the fresh index (collision/hint
  // derivations) — the shared per-cohort assembler reproduces the previous inline wiring exactly.
  const crossCohortIndex = useCrossCohortIndex(props.crossCohortOccupancy);
  const {
    placements,
    collisions,
    dropHints,
    hours,
    incompleteCount,
    parkedBundles,
    justDuplicated,
    isExploded,
    toggleExploded,
    startDragHints,
    clearDragHints,
    error,
    clearError,
    weekModeByCourseId,
    actions,
  } = useCohortBoardState(props, crossCohortIndex, crossCohortIndex);
  const { removePlacement, setWeek, removeBundle, duplicateBundle, removeParked } = actions;

  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  const { collapsed, setCollapsed } = usePaletteDisclosure(paletteCollapsed);
  const inspection = useCollisionInspection(collisions);
  const { hintMode, setHintMode } = useHintMode();

  // The single board is the degenerate one-cohort case: one constant resolver feeds the shared
  // dispatch (`applyDropAction`), so the lift button and the drop handler route identically.
  const resolveState = () => ({ actions, groupings, weekModeByCourseId });

  // Every parked bundle on this board belongs to its one cohort — a total map so the shelf tags each
  // card and scopes its place-back drag (the combined shelf maps both cohorts; this maps the one).
  const shelfCohortById = useMemo(
    () => new Map<string, Cohort>(parkedBundles.map((bundle) => [bundle.id, cohort] as const)),
    [parkedBundles, cohort],
  );

  // Bundle the per-cell handlers + drag-hint state into one referentially-stable object, spread once
  // into each cell (mirrors `PairedPlannerGrid`) instead of hand-threading the 11 fields per hop.
  const wiring = useCellWiring({
    dropHints,
    hintMode,
    isExploded,
    justDuplicated,
    onRemove: removePlacement,
    onSetWeek: setWeek,
    onToggleBundle: toggleExploded,
    onRemoveBundle: removeBundle,
    onDuplicateBundle: duplicateBundle,
    onLiftBundle: (day, period) => {
      applyDropAction({ kind: "liftBundle", cohort, day, period }, resolveState, { collapseUnlessPinned });
    },
    onInspect: inspection.open,
  });

  // Only the placement write path can error now — ungroup is ephemeral UI state (no writes).
  const banner = error;

  // Capture the dragged identity so the hint map has an input; the source's `data` is the
  // same opaque `DragData` the drop handler reads (undefined only if dropped from nowhere).
  function handleDragStart(event: DragStartEvent) {
    const data = event.operation.source?.data as DragData | undefined;
    if (data) startDragHints(data);
  }

  function handleDrop(event: DragEndEvent) {
    clearDragHints(); // clears for both a successful drop and a canceled drag (Escape / drop in void)
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return; // dropped outside any cell — no-op (removal is via "×")

    // The ONE shared router resolves the drop to an action descriptor (or null = no-op); the ONE
    // shared dispatch (`applyDropAction`) wires it to the optimistic placement actions. The single
    // board is the degenerate one-cohort case: it passes its one `cohort` as `activeCohort`, its
    // untagged cells/drags resolve to that cohort, and the cross-cohort guard trivially passes.
    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData, cohort);
    if (action) applyDropAction(action, resolveState, { collapseUnlessPinned });
  }

  // One decision over the left column's three states, mirroring the `switch (data.kind)` drop
  // dispatch: the orchestrator resolves the view once; each view is a dumb component.
  const paletteView = resolvePaletteView({ groupingsCount: groupings.length, stale });

  if (paletteView === "empty") {
    return (
      <>
        <BoardHeader planName={planName} planId={planId} cohort={cohort} />
        <div data-slot="planner-board" className="p-6">
          <ComputeGroupingsEmptyState planId={planId} cohort={cohort} />
        </div>
      </>
    );
  }

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
          cohort={cohort}
        />
      }
      palette={
        <PlannerPalette
          groupings={groupings}
          names={names}
          hours={hours}
          stale={paletteView === "stale"}
          planId={planId}
          cohort={cohort}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />
      }
      center={
        <div className="flex min-h-0 flex-col gap-3">
          {banner && <ErrorBanner message={placementErrorMessage(banner, names)} onDismiss={clearError} />}
          <div className="flex shrink-0 justify-end">
            <DragHintModeToggle mode={hintMode} onChange={setHintMode} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <PlannerGrid
              days={days}
              periods={periods}
              gridLabel={`${cohortLabel(cohort)} timetable`}
              cohort={cohort}
              placements={placements}
              names={names}
              collisions={collisions}
              wiring={wiring}
            />
          </div>
        </div>
      }
      shelf={
        <ShelfDrawer
          parkedBundles={parkedBundles}
          names={names}
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
          target={inspection.target}
          violations={inspectedViolations(inspection.target, collisions)}
          names={names}
          teacherNames={teacherNames}
          studentNames={studentNames}
          weekByCourseId={inspectedWeeks(inspection.target, placements)}
          cohort={cohort}
          onClose={inspection.close}
        />
      }
      overlay={
        <GroupDragOverlay groupings={groupings} names={names} placements={placements} parkedBundles={parkedBundles} />
      }
    />
  );
}
