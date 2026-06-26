import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cohortLabel, type PlacementWeek } from "@/shared/config";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import BoardHeader from "./BoardHeader";
import CollisionDetailsDialog from "./CollisionDetailsDialog";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import DragHintModeToggle from "./DragHintModeToggle";
import ErrorBanner from "./ErrorBanner";
import GroupDragOverlay from "./GroupDragOverlay";
import GroupingStalePanel from "./GroupingStalePanel";
import PlanSummaryBar from "./PlanSummaryBar";
import PlannerGrid from "./PlannerGrid";
import PlannerPalette from "./PlannerPalette";
import { DEFAULT_HINT_MODE, readHintMode, subscribeHintMode, writeHintMode } from "../lib/drag-hint-mode";
import { buildAvailabilityIndex } from "../model/availability-index";
import type { AvailabilityIndex } from "../model/availability-index";
import { buildCrossCohortIndex } from "../model/cross-cohort-index";
import type { CrossCohortIndex } from "../model/cross-cohort-index";
import type { CellData, DragData, PlannerBoardProps } from "../model/drag";
import { cellKey, deriveCellViolations } from "../model/collisions";
import type { CellCollisions } from "../model/collisions";
import { deriveDropHints, resolveDragHintContext } from "../model/drop-hints";
import type { DragHintContext } from "../model/drop-hints";
import { resolvePaletteView } from "../model/palette-view";
import type { GroupingCourse, PlannerGrouping } from "../model/grouping";
import { countIncompleteCourses, deriveHours } from "../model/hours";
import type { LocalPlacement } from "../model/placement";
import { placementErrorMessage } from "../model/placement-transitions";
import { usePlacements } from "../model/use-placements";
import { useExplodedCells } from "../model/use-exploded-cells";

/**
 * Planner island root: orchestrates placement state, collision/hours derivations,
 * and the palette/grid views. Drops always land (accept-and-flag); the only way to
 * remove a course is the chip's "×".
 */
export default function PlannerBoard({ planName, ...props }: PlannerBoardProps & { planName: string }) {
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

    const data = source.data as DragData;
    const cell = target.data as CellData;
    switch (data.kind) {
      case "course":
        addCourse(data.courseId, cell);
        break;
      case "placement":
        movePlacement(data.placementId, cell);
        break;
      case "grouping":
        dropGroup(data.groupingId, cell);
        break;
      case "bundle":
        moveBundle(data.day, data.period, cell);
        break;
    }
  }

  // Unknown groupingId → empty member list → no-op. An opposite-week grouping lands its members
  // on alternating weeks; a plain grouping resolves each member by its own eligibility.
  function dropGroup(groupingId: string, cell: CellData) {
    const grouping = groupings.find((candidate) => candidate.id === groupingId);
    addGroup(grouping?.memberIds ?? [], cell, { oppositeWeek: grouping?.oppositeWeek ?? false });
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
        <PlanSummaryBar planName={planName} incompleteCount={incompleteCount} planId={planId} cohort={cohort} />

        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[18rem_1fr]">
          {paletteView === "stale" ? (
            <GroupingStalePanel planId={planId} cohort={cohort} />
          ) : (
            <PlannerPalette groupings={groupings} names={names} hours={hours} />
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
                onInspect={inspection.open}
              />
            </div>
          </div>
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
      <GroupDragOverlay groupings={groupings} names={names} placements={placements} />
    </DragDropProvider>
  );
}

// Shared course lookup, built once for both the collision and drag-hint derivations.
function useCatalogById(catalog: GroupingCourse[]) {
  return useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
}

// Index the raw availability cells (a serializable prop) into the Maps the derivations read.
function useAvailabilityIndex(availability: PlannerBoardProps["availability"]) {
  return useMemo(() => buildAvailabilityIndex(availability), [availability]);
}

// Index the raw sibling-occupancy cells (a serializable prop) into the cross-cohort Map.
function useCrossCohortIndex(occupancy: PlannerBoardProps["crossCohortOccupancy"]) {
  return useMemo(() => buildCrossCohortIndex(occupancy), [occupancy]);
}

function useCollisions(
  placements: LocalPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
) {
  return useMemo(
    () => deriveCellViolations(placements, catalogById, availability, occupiedByTeacher),
    [placements, catalogById, availability, occupiedByTeacher],
  );
}

// Owns the active-drag identity and derives the per-cell hint map from it. Keyed on live
// placements so marks stay correct if an optimistic placement settles or rolls back mid-drag.
// The map is null when no drag is active, so cells render no hint.
function useDragHints(
  catalogById: Map<string, GroupingCourse>,
  placements: LocalPlacement[],
  groupings: PlannerGrouping[],
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
) {
  const [context, setContext] = useState<DragHintContext | null>(null);
  const dropHints = useMemo(
    () => deriveDropHints(context, placements, catalogById, availability, occupiedByTeacher),
    [context, placements, catalogById, availability, occupiedByTeacher],
  );
  return {
    dropHints,
    startDragHints: (data: DragData) => {
      setContext(resolveDragHintContext(data, { catalogById, groupings, placements }));
    },
    clearDragHints: () => {
      setContext(null);
    },
  };
}

// Turns the hook's `lastDuplicated` outcome into a transient, self-clearing highlight the grid
// reads. The highlight is *derived* during render (active unless its nonce has been cleared), so no
// state is set synchronously in the effect; the effect only schedules the clear. `lastDuplicated`
// is a fresh object (bumped nonce) on every duplicate, so a same-cell repeat re-arms the timer and
// re-fires the highlight; the timer is cleared on unmount. The board owns this lifecycle.
const DUPLICATE_HIGHLIGHT_MS = 1200;

function useDuplicateHighlight(last: (CellData & { nonce: number }) | null) {
  const [clearedNonce, setClearedNonce] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => {
      setClearedNonce(last.nonce);
    }, DUPLICATE_HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [last]);
  return last && last.nonce !== clearedNonce ? last : null;
}

// Per-device hint encoding, persisted in localStorage. `useSyncExternalStore` returns the
// default during SSR and the hydration render (the island is `client:load`) via the server
// snapshot, then switches to the stored value — so the toggle's active state can't trip a
// hydration mismatch. Drags never run at hydration, so the cells themselves can't mismatch.
function useHintMode() {
  const hintMode = useSyncExternalStore(subscribeHintMode, readHintMode, () => DEFAULT_HINT_MODE);
  return { hintMode, setHintMode: writeHintMode };
}

function useCollisionInspection(collisions: Map<string, CellCollisions>) {
  const [target, setTarget] = useState<CollisionInspectionTarget | null>(null);

  // The collision map is a reactive derivation; if the inspected cell's violations
  // vanish while the dialog is open (participant moved or removed elsewhere, server
  // reconciliation), close rather than show stale content. Adjust-state-during-render
  // (not an effect) so the close lands in the same render as the recompute.
  if (target && !collisions.has(cellKey(target.day, target.period))) setTarget(null);

  return {
    target,
    open: setTarget,
    close: () => {
      setTarget(null);
    },
  };
}

const inspectedViolations = (target: CollisionInspectionTarget | null, collisions: Map<string, CellCollisions>) =>
  target ? (collisions.get(cellKey(target.day, target.period))?.violations ?? []) : [];

// The inspected cell's placement weeks (courseId → week), for the dialog's same-week hint.
const inspectedWeeks = (
  target: CollisionInspectionTarget | null,
  placements: LocalPlacement[],
): Record<string, PlacementWeek> => {
  if (!target) return {};
  const weeks: Record<string, PlacementWeek> = {};
  for (const placement of placements)
    if (placement.day === target.day && placement.period === target.period) weeks[placement.courseId] = placement.week;
  return weeks;
};

function useHours(placements: LocalPlacement[], catalog: GroupingCourse[]) {
  const hours = useMemo(() => deriveHours(placements, catalog), [placements, catalog]);
  const incompleteCount = useMemo(() => countIncompleteCourses(hours), [hours]);
  return { hours, incompleteCount };
}

// Disable the drop "return" animation. A palette course is *copied* onto the grid —
// its source stays in the palette — so dnd-kit's default animation flies the drag
// feedback back to the palette, which reads as "the drop bounced / failed." With the
// chip already placed optimistically, the feedback should just vanish at the drop point.
const PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin,
);
