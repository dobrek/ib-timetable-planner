import { useMemo, useState } from "react";
import type { Cohort, PlacementWeek } from "@/shared/config";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import CollisionDetailsDialog, { type CollisionInspectionTarget } from "./CollisionDetailsDialog";
import DragHintModeToggle from "./DragHintModeToggle";
import ErrorBanner from "./ErrorBanner";
import GroupDragOverlay from "./GroupDragOverlay";
import PairedPlannerGrid, { type PairedColumn } from "./PairedPlannerGrid";
import { useHintMode, useShelfDisclosure } from "./board-disclosure";
import { cellKey } from "../model/collisions";
import { resolveCombinedDrop } from "../model/combined-drop";
import type { CellData, DragData, DropTargetData, PlannerBoardProps } from "../model/drag";
import { placementErrorMessage } from "../model/placement-transitions";
import type { LocalPlacement } from "../model/placement";
import { useCombinedBoardState, type CohortBoardState } from "../model/use-cohort-board-state";

type Props = {
  planName: string;
  dp1: PlannerBoardProps;
  dp2: PlannerBoardProps;
  paletteCollapsed: boolean;
};

/**
 * The combined two-cohort board (S-06): ONE `DragDropProvider` over both cohorts, the live
 * cross-index orchestration (`useCombinedBoardState`), a cohort-routed drop dispatch with the
 * cross-cohort move guard, the shared overlay + single inspection dialog, and the shell-level UI
 * singletons (one hint mode, one shelf disclosure). The palette + shared shelf drawer land in
 * Phase 4; this phase delivers the working editable grid with live cross-cohort validation.
 */
export default function CombinedPlannerBoard({ planName, dp1: dp1Props, dp2: dp2Props }: Props) {
  const { dp1, dp2 } = useCombinedBoardState(dp1Props, dp2Props);
  const byCohort: Record<Cohort, CohortBoardState> = { dp1, dp2 };
  const { hintMode, setHintMode } = useHintMode();
  const { collapseUnlessPinned } = useShelfDisclosure();

  const planId = dp1Props.planId;
  const days = dp1Props.days;
  const periods = dp1Props.periods;

  // Union course names for the shared overlay (teacher/student names are already the union from the
  // loader, identical on both props). A cross-cohort bundle/parked overlay can reference either set.
  const overlayNames = useMemo(() => ({ ...dp1.names, ...dp2.names }), [dp1.names, dp2.names]);

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
    const sourceCohort = "cohort" in data ? data.cohort : undefined;
    if (!sourceCohort) return; // cohort-free palette drags get their cohort in Phase 4
    byCohort[sourceCohort].startDragHints(data);
    setActiveDragCohort(sourceCohort);
  }

  function handleDrop(event: DragEndEvent) {
    dp1.clearDragHints();
    dp2.clearDragHints();
    setActiveDragCohort(null);
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return; // dropped outside any cell — removal is via the chip "×"

    // The pure router resolves the target cohort and applies the cross-cohort guard; null = no-op.
    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData);
    if (!action) return;
    const { actions } = byCohort[action.cohort];

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
          <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-sm font-medium">Combined view</span>
          <a
            href={`/plans/${planId}?cohort=dp1`}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            ← Single cohort
          </a>
          <div className="ml-auto">
            <DragHintModeToggle mode={hintMode} onChange={setHintMode} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
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
      </div>

      <CollisionDetailsDialog
        target={inspection?.target ?? null}
        violations={
          inspection && inspected
            ? (inspected.collisions.get(cellKey(inspection.target.day, inspection.target.period))?.violations ?? [])
            : []
        }
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

// The inspected cell's placement weeks (courseId → week), for the dialog's same-week hint.
const inspectedWeeks = (
  target: CollisionInspectionTarget,
  placements: LocalPlacement[],
): Record<string, PlacementWeek> => {
  const weeks: Record<string, PlacementWeek> = {};
  for (const placement of placements)
    if (placement.day === target.day && placement.period === target.period) weeks[placement.courseId] = placement.week;
  return weeks;
};

// Disable the drop "return" animation, matching the single-cohort board: a palette course is copied
// onto the grid (its source stays), so the default fly-back reads as a failed drop.
const PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin,
);
