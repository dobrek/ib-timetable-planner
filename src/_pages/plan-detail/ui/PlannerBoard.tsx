import { useMemo } from "react";
import { cohortLabel } from "@/shared/config";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import {
  BoardHeader,
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
import { PlannerGrid } from "./grid";
import { CollisionDetailsDialog, GroupDragOverlay } from "./overlay";
import { ComputeGroupingsEmptyState, GroupingStalePanel, PlannerPalette } from "./palette";
import ShelfDrawer from "./shelf/ShelfDrawer";
import type { CellData, DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import { resolvePaletteView } from "../model/palette-view";
import { resolveSingleDrop } from "../model/single-drop";
import {
  useAvailabilityIndex,
  useCatalogById,
  useCollisions,
  useCrossCohortIndex,
  useDragHints,
  useDuplicateHighlight,
  useHours,
} from "../model/use-board-derivations";
import { placementErrorMessage } from "../model/placement-transitions";
import type { ParkedMember } from "../model/parked";
import { defaultParkedWeek, groupingParkedMembers } from "../model/parked-members";
import { usePlacements } from "../model/use-placements";
import { useExplodedCells } from "../model/use-exploded-cells";

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
  const { planId, cohort, days, periods, groupings, stale, names, teacherNames, studentNames, catalog, availability } =
    props;
  const { crossCohortOccupancy } = props;

  const weekModeByCourseId = useMemo(() => new Map(catalog.map((course) => [course.id, course.weekMode])), [catalog]);
  const catalogById = useCatalogById(catalog);
  const availabilityIndex = useAvailabilityIndex(availability);
  const crossCohortIndex = useCrossCohortIndex(crossCohortOccupancy);

  const {
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
    clearError,
  } = usePlacements(props.placements, {
    planId,
    cohort,
    weekModeByCourseId,
    catalogById,
    availabilityIndex,
    crossCohortIndex,
    days,
    periods,
    initialParked: props.parkedBundles,
  });
  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  const { collapsed, setCollapsed } = usePaletteDisclosure(paletteCollapsed);
  const justDuplicated = useDuplicateHighlight(lastDuplicated);
  const { isExploded, toggleExploded } = useExplodedCells();
  const collisions = useCollisions(placements, catalogById, availabilityIndex, crossCohortIndex);
  const inspection = useCollisionInspection(collisions);
  const { hours, incompleteCount } = useHours(placements, catalog);
  const { dropHints, startDragHints, clearDragHints } = useDragHints(
    catalogById,
    placements,
    groupings,
    availabilityIndex,
    crossCohortIndex,
  );
  const { hintMode, setHintMode } = useHintMode();

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

    // The pure router resolves the drop to an action descriptor (or null = no-op); this thin
    // dispatch wires it to the optimistic placement actions. Mirrors `CombinedPlannerBoard`.
    const action = resolveSingleDrop(source.data as DragData, target.data as DropTargetData);
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
    <DragDropProvider plugins={PLUGINS} onDragStart={handleDragStart} onDragEnd={handleDrop}>
      <div className="flex min-h-0 flex-1 flex-col">
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

        {/* `minmax(0,1fr)` on the board column (not bare `1fr`, whose min is min-content): lets the
            timetable track shrink + scroll instead of forcing the grid wider than the viewport — so
            the `auto` shelf column is never cropped when both the sidebar and shelf are expanded. */}
        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
          {paletteView === "stale" ? (
            <GroupingStalePanel planId={planId} cohort={cohort} />
          ) : (
            <PlannerPalette
              groupings={groupings}
              names={names}
              hours={hours}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
            />
          )}

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
                dropHints={dropHints}
                hintMode={hintMode}
                isExploded={isExploded}
                justDuplicated={justDuplicated}
                onRemove={removePlacement}
                onSetWeek={setWeek}
                onToggleBundle={toggleExploded}
                onRemoveBundle={removeBundle}
                onDuplicateBundle={duplicateBundle}
                onLiftBundle={liftBundle}
                onInspect={inspection.open}
              />
            </div>
          </div>

          <ShelfDrawer
            parkedBundles={parkedBundles}
            names={names}
            expanded={shelfExpanded}
            pinned={pinned}
            onExpandedChange={setExpanded}
            onPinnedChange={setPinned}
            onRemoveParked={removeParked}
          />
        </div>
      </div>
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
      <GroupDragOverlay groupings={groupings} names={names} placements={placements} parkedBundles={parkedBundles} />
    </DragDropProvider>
  );
}

// Disable the drop "return" animation. A palette course is *copied* onto the grid —
// its source stays in the palette — so dnd-kit's default animation flies the drag
// feedback back to the palette, which reads as "the drop bounced / failed." With the
// chip already placed optimistically, the feedback should just vanish at the drop point.
const PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin,
);
