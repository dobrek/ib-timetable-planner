import { cohortLabel } from "@/shared/config";
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
import type { CellData, DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import { resolveCombinedDrop } from "../model/combined-drop";
import { resolvePaletteView } from "../model/palette-view";
import { useCrossCohortIndex } from "../model/use-board-derivations";
import { useCohortBoardState } from "../model/use-cohort-board-state";
import { placementErrorMessage } from "../model/placement-transitions";
import type { ParkedMember } from "../model/parked";
import { defaultParkedWeek, groupingParkedMembers } from "../model/parked-members";

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
  const {
    addCourse,
    addGroup,
    movePlacement,
    removePlacement,
    setWeek,
    moveBundle,
    removeBundle,
    duplicateBundle,
    shelveBundle,
    placeBack,
    parkMembers,
    removeParked,
  } = actions;

  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  const { collapsed, setCollapsed } = usePaletteDisclosure(paletteCollapsed);
  const inspection = useCollisionInspection(collisions);
  const { hintMode, setHintMode } = useHintMode();

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
    onLiftBundle: liftBundle,
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

    // The ONE shared router resolves the drop to an action descriptor (or null = no-op); this thin
    // dispatch wires it to the optimistic placement actions. The single board is the degenerate
    // one-cohort case: it passes its one `cohort` as `activeCohort`, its untagged cells/drags resolve
    // to that cohort, and the cross-cohort guard trivially passes. Same dispatch as the combined board.
    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData, cohort);
    if (!action) return;

    switch (action.kind) {
      case "addCourse":
        addCourse(action.courseId, action.cell);
        break;
      case "dropGroup":
        dropGroup(action.groupingId, action.cell);
        break;
      case "movePlacement":
        movePlacement(action.placementId, action.cell);
        break;
      case "moveBundle":
        moveBundle(action.day, action.period, action.cell);
        break;
      case "liftBundle":
        liftBundle(action.day, action.period);
        break;
      case "placeBack":
        placeBack(action.shelfBundleId, action.cell);
        collapseUnlessPinned();
        break;
      case "parkCourse":
        // Onto the shelf → park the single course directly.
        parkToShelf([{ courseId: action.courseId, week: defaultParkedWeek(action.courseId, weekModeByCourseId) }]);
        break;
      case "parkGroup":
        // Onto the shelf → park the grouping's resolved members directly.
        parkToShelf(groupingParkedMembers(action.groupingId, groupings, weekModeByCourseId));
        break;
    }
  }

  // Lift the bundle at a cell to the shelf (the button affordance and drag-to-shelf both call this).
  function liftBundle(day: number, period: number) {
    shelveBundle(day, period);
    collapseUnlessPinned();
  }

  // Unknown groupingId → empty member list → no-op. An opposite-week grouping lands its members
  // on alternating weeks; a plain grouping resolves each member by its own eligibility.
  function dropGroup(groupingId: string, cell: CellData) {
    const grouping = groupings.find((candidate) => candidate.id === groupingId);
    addGroup(grouping?.memberIds ?? [], cell, { oppositeWeek: grouping?.oppositeWeek ?? false });
  }

  // Park a course-set onto the shelf. Re-dropping an already-parked set deliberately parks it
  // again (a second card) — by author decision after user testing. Mirrors the lift's
  // auto-collapse so the drawer behaves the same however a bundle gets parked. Members are
  // resolved by the shared `model/parked-members` helper (the combined board parks identically).
  function parkToShelf(members: ParkedMember[]) {
    if (members.length === 0) return;
    parkMembers(members);
    collapseUnlessPinned();
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
