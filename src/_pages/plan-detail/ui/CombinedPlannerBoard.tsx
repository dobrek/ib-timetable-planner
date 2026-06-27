import { useMemo, useState } from "react";
import type { Cohort } from "@/shared/config";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import {
  CohortSwitcher,
  DragHintModeToggle,
  ErrorBanner,
  inspectedViolations,
  inspectedWeeks,
  useHintMode,
  usePaletteDisclosure,
  useShelfDisclosure,
} from "./chrome";
import { PairedPlannerGrid, type PairedColumn } from "./grid";
import { CollisionDetailsDialog, type CollisionInspectionTarget, GroupDragOverlay } from "./overlay";
import { CombinedPalettePanel, type PaletteCohortData } from "./palette";
import ShelfDrawer from "./shelf/ShelfDrawer";
import { cellKey } from "../model/collisions";
import { resolveCombinedDrop } from "../model/combined-drop";
import type { CellData, DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import type { ParkedMember } from "../model/parked";
import { defaultParkedWeek, groupingParkedMembers } from "../model/parked-members";
import { placementErrorMessage } from "../model/placement-transitions";
import { useCombinedBoardState, type CohortBoardState } from "../model/use-cohort-board-state";

type Props = {
  planName: string;
  dp1: PlannerBoardProps;
  dp2: PlannerBoardProps;
};

/**
 * The combined two-cohort board (S-06): ONE `DragDropProvider` over both cohorts, the live
 * cross-index orchestration (`useCombinedBoardState`), a cohort-routed drop dispatch with the
 * cross-cohort move guard, the shared overlay + single inspection dialog, the toggle palette + one
 * shared cohort-tagged shelf, and the shell-level UI singletons (one hint mode, one shelf/palette
 * disclosure). Compact-first: the palette defaults collapsed and the shelf closed.
 */
export default function CombinedPlannerBoard({ planName, dp1: dp1Props, dp2: dp2Props }: Props) {
  const { dp1, dp2 } = useCombinedBoardState(dp1Props, dp2Props);
  const byCohort: Record<Cohort, CohortBoardState> = { dp1, dp2 };
  const { hintMode, setHintMode } = useHintMode();
  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  // Compact-first: the palette starts collapsed regardless of the single-board cookie.
  const { collapsed: paletteCollapsed, setCollapsed: setPaletteCollapsed } = usePaletteDisclosure(true);
  // The palette's active cohort doubles as the drag-target signal for a (cohort-free) palette drag.
  const [paletteCohort, setPaletteCohort] = useState<Cohort>("dp1");

  const planId = dp1Props.planId;
  const days = dp1Props.days;
  const periods = dp1Props.periods;

  // Union course names for the shared overlay (teacher/student names are already the union from the
  // loader, identical on both props). A cross-cohort bundle/parked overlay can reference either set.
  const overlayNames = useMemo(() => ({ ...dp1.names, ...dp2.names }), [dp1.names, dp2.names]);

  // One shared shelf: both cohorts' parked bundles in one drawer, each tagged + place-back routed by
  // its own cohort. `shelfCohortById` maps shelfBundleId → cohort for the tag + the remove routing.
  const shelfCohortById = useMemo(
    () =>
      new Map<string, Cohort>([
        ...dp1.parkedBundles.map((bundle) => [bundle.id, "dp1"] as const),
        ...dp2.parkedBundles.map((bundle) => [bundle.id, "dp2"] as const),
      ]),
    [dp1.parkedBundles, dp2.parkedBundles],
  );

  // Source cohort of the active drag — drives the sibling-column dimming. Null between drags.
  const [activeDragCohort, setActiveDragCohort] = useState<Cohort | null>(null);
  // The shell owns the ONE active inspection across both columns: opening one closes the other.
  const [inspection, setInspection] = useState<{ cohort: Cohort; target: CollisionInspectionTarget } | null>(null);

  // Close the dialog if the inspected cell's violations vanish in its cohort (adjust-state-during-
  // render, mirroring the single board's inspection hook).
  if (
    inspection &&
    !byCohort[inspection.cohort].collisions.has(cellKey(inspection.target.day, inspection.target.period))
  )
    setInspection(null);

  function handleDragStart(event: DragStartEvent) {
    const data = event.operation.source?.data as DragData | undefined;
    if (!data) return;
    // A relocating drag carries its source cohort; a cohort-free palette drag (course/grouping)
    // targets the palette's active cohort — both light that cohort's hints and dim the sibling.
    const dragCohort = "cohort" in data && data.cohort ? data.cohort : paletteCohort;
    byCohort[dragCohort].startDragHints(data);
    setActiveDragCohort(dragCohort);
  }

  function handleDrop(event: DragEndEvent) {
    dp1.clearDragHints();
    dp2.clearDragHints();
    setActiveDragCohort(null);
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return; // dropped outside any cell — removal is via the chip "×"

    // The pure router resolves the target cohort and applies the cross-cohort guard; null = no-op.
    // A cohort-free palette drag dropped on the cell-less shelf parks under `paletteCohort`.
    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData, paletteCohort);
    if (!action) return;
    const state = byCohort[action.cohort];
    const { actions } = state;

    switch (action.kind) {
      case "addCourse":
        actions.addCourse(action.courseId, action.cell);
        break;
      case "dropGroup":
        dropGroup(action.cohort, action.groupingId, action.cell);
        break;
      case "movePlacement":
        actions.movePlacement(action.placementId, action.cell);
        break;
      case "moveBundle":
        actions.moveBundle(action.day, action.period, action.cell);
        break;
      case "liftBundle":
        actions.shelveBundle(action.day, action.period);
        collapseUnlessPinned();
        break;
      case "placeBack":
        actions.placeBack(action.shelfBundleId, action.cell);
        collapseUnlessPinned();
        break;
      case "parkCourse":
        // Palette course dropped on the cell-less shelf → park the single course under the active cohort.
        parkToShelf(action.cohort, [
          { courseId: action.courseId, week: defaultParkedWeek(action.courseId, state.weekModeByCourseId) },
        ]);
        break;
      case "parkGroup":
        // Palette grouping dropped on the shelf → park its resolved members under the active cohort.
        parkToShelf(action.cohort, groupingParkedMembers(action.groupingId, state.groupings, state.weekModeByCourseId));
        break;
    }
  }

  function dropGroup(cohort: Cohort, groupingId: string, cell: CellData) {
    const state = byCohort[cohort];
    const grouping = state.groupings.find((candidate) => candidate.id === groupingId);
    state.actions.addGroup(grouping?.memberIds ?? [], cell, { oppositeWeek: grouping?.oppositeWeek ?? false });
  }

  function liftBundle(cohort: Cohort, day: number, period: number) {
    byCohort[cohort].actions.shelveBundle(day, period);
    collapseUnlessPinned();
  }

  // Park a resolved member-set under `cohort` (no-op on empty) + auto-collapse unless pinned — the
  // combined-view analog of the single board's `parkToShelf`, routed to the active cohort's store.
  function parkToShelf(cohort: Cohort, members: ParkedMember[]) {
    if (members.length === 0) return;
    byCohort[cohort].actions.parkMembers(members);
    collapseUnlessPinned();
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
        liftBundle(cohort, day, period);
      },
      onInspect: (target) => {
        setInspection({ cohort, target });
      },
    },
  });

  const inspected = inspection ? byCohort[inspection.cohort] : null;

  return (
    <DragDropProvider plugins={PLUGINS} onDragStart={handleDragStart} onDragEnd={handleDrop}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b px-6 py-2">
          <h1 className="text-foreground text-base font-semibold">{planName}</h1>
          <CohortSwitcher planId={planId} active="combined" />
          <div className="ml-auto">
            <DragHintModeToggle mode={hintMode} onChange={setHintMode} />
          </div>
        </div>

        {/* `minmax(0,1fr)` on the board column lets the wide paired grid scroll instead of forcing
            the layout wider than the viewport — so the `auto` palette/shelf columns are never cropped. */}
        <div
          data-slot="combined-board"
          className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
        >
          <CombinedPalettePanel
            dp1={paletteData(dp1)}
            dp2={paletteData(dp2)}
            activeCohort={paletteCohort}
            onActiveCohortChange={setPaletteCohort}
            collapsed={paletteCollapsed}
            onCollapsedChange={setPaletteCollapsed}
          />

          <div className="flex min-h-0 flex-col gap-3">
            {dp1.error && (
              <ErrorBanner message={placementErrorMessage(dp1.error, dp1.names)} onDismiss={dp1.clearError} />
            )}
            {dp2.error && (
              <ErrorBanner message={placementErrorMessage(dp2.error, dp2.names)} onDismiss={dp2.clearError} />
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              <PairedPlannerGrid
                days={days}
                periods={periods}
                gridLabel={`${planName} combined timetable`}
                dp1={buildColumn("dp1", dp1)}
                dp2={buildColumn("dp2", dp2)}
                activeDragCohort={activeDragCohort}
              />
            </div>
          </div>

          <ShelfDrawer
            parkedBundles={[...dp1.parkedBundles, ...dp2.parkedBundles]}
            names={overlayNames}
            expanded={shelfExpanded}
            pinned={pinned}
            cohortById={shelfCohortById}
            onExpandedChange={setExpanded}
            onPinnedChange={setPinned}
            onRemoveParked={removeParked}
          />
        </div>
      </div>

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

      <GroupDragOverlay
        groupings={[...dp1.groupings, ...dp2.groupings]}
        names={overlayNames}
        placements={[...dp1.placements, ...dp2.placements]}
        parkedBundles={[...dp1.parkedBundles, ...dp2.parkedBundles]}
        placementsByCohort={{ dp1: dp1.placements, dp2: dp2.placements }}
      />
    </DragDropProvider>
  );
}

// Disable the drop "return" animation, matching the single-cohort board: a palette course is copied
// onto the grid (its source stays), so the default fly-back reads as a failed drop.
const PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin,
);
