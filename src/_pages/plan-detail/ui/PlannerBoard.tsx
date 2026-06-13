import { useMemo, useState, useSyncExternalStore } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import CollisionDetailsDialog from "./CollisionDetailsDialog";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import DragHintModeToggle from "./DragHintModeToggle";
import ErrorBanner from "./ErrorBanner";
import GroupDragOverlay from "./GroupDragOverlay";
import PlanSummaryBar from "./PlanSummaryBar";
import PlannerGrid from "./PlannerGrid";
import PlannerPalette from "./PlannerPalette";
import { DEFAULT_HINT_MODE, readHintMode, subscribeHintMode, writeHintMode } from "../lib/drag-hint-mode";
import type { CellData, DragData, PlannerBoardProps } from "../model/drag";
import { cellKey, deriveCellViolations } from "../model/collisions";
import type { CellCollisions } from "../model/collisions";
import { deriveDropHints, resolveDragHintContext } from "../model/drop-hints";
import type { DragHintContext } from "../model/drop-hints";
import type { GroupingCourse, PlannerGrouping } from "../model/grouping";
import { countIncompleteCourses, deriveHours } from "../model/hours";
import type { LocalPlacement } from "../model/placement";
import { placementErrorMessage } from "../model/placement-transitions";
import { usePlacements } from "../model/use-placements";

/**
 * Planner island root: orchestrates placement state, collision/hours derivations,
 * and the palette/grid views. Drops always land (accept-and-flag); the only way to
 * remove a course is the chip's "×".
 */
export default function PlannerBoard({ planName, ...props }: PlannerBoardProps & { planName: string }) {
  const { planId, cohort, days, periods, groupings, names, teacherNames, studentNames, catalog } = props;

  const { placements, error, addCourse, addGroup, movePlacement, removePlacement, clearError } = usePlacements(
    props.placements,
    { planId, cohort },
  );
  const catalogById = useCatalogById(catalog);
  const collisions = useCollisions(placements, catalogById);
  const inspection = useCollisionInspection(collisions);
  const { hours, incompleteCount } = useHours(placements, catalog);
  const { dropHints, startDragHints, clearDragHints } = useDragHints(catalogById, placements, groupings);
  const { hintMode, setHintMode } = useHintMode();

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
    }
  }

  // Unknown groupingId → empty member list → no-op.
  function dropGroup(groupingId: string, cell: CellData) {
    const members = groupings.find((grouping) => grouping.id === groupingId)?.memberIds ?? [];
    addGroup(members, cell);
  }

  if (groupings.length === 0) {
    return (
      <>
        <div className="flex shrink-0 items-center border-b px-6 py-2">
          <h1 className="text-base font-semibold">{planName}</h1>
        </div>
        <div data-slot="planner-board" className="p-6">
          <ComputeGroupingsEmptyState planId={planId} cohort={cohort} />
        </div>
      </>
    );
  }

  return (
    <DragDropProvider plugins={PLUGINS} onDragStart={handleDragStart} onDragEnd={handleDrop}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PlanSummaryBar planName={planName} incompleteCount={incompleteCount} />

        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]">
          <PlannerPalette groupings={groupings} names={names} hours={hours} />

          <div className="flex min-h-0 flex-col gap-3">
            {error && <ErrorBanner message={placementErrorMessage(error, names)} onDismiss={clearError} />}
            <div className="flex shrink-0 justify-end">
              <DragHintModeToggle mode={hintMode} onChange={setHintMode} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <PlannerGrid
                days={days}
                periods={periods}
                placements={placements}
                names={names}
                collisions={collisions}
                dropHints={dropHints}
                hintMode={hintMode}
                onRemove={removePlacement}
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
        onClose={inspection.close}
      />
      <GroupDragOverlay groupings={groupings} names={names} />
    </DragDropProvider>
  );
}

// Shared course lookup, built once for both the collision and drag-hint derivations.
function useCatalogById(catalog: GroupingCourse[]) {
  return useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
}

function useCollisions(placements: LocalPlacement[], catalogById: Map<string, GroupingCourse>) {
  return useMemo(() => deriveCellViolations(placements, catalogById), [placements, catalogById]);
}

// Owns the active-drag identity and derives the per-cell hint map from it. Keyed on live
// placements so marks stay correct if an optimistic placement settles or rolls back mid-drag.
// The map is null when no drag is active, so cells render no hint.
function useDragHints(
  catalogById: Map<string, GroupingCourse>,
  placements: LocalPlacement[],
  groupings: PlannerGrouping[],
) {
  const [context, setContext] = useState<DragHintContext | null>(null);
  const dropHints = useMemo(
    () => deriveDropHints(context, placements, catalogById),
    [context, placements, catalogById],
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
