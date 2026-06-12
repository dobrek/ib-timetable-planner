import { useMemo, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import CollisionDetailsDialog from "./CollisionDetailsDialog";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import ErrorBanner from "./ErrorBanner";
import GroupDragOverlay from "./GroupDragOverlay";
import PlanSummaryBar from "./PlanSummaryBar";
import PlannerGrid from "./PlannerGrid";
import PlannerPalette from "./PlannerPalette";
import type { CellData, DragData, PlannerBoardProps } from "../model/drag";
import { cellKey, deriveCellViolations } from "../model/collisions";
import type { CellCollisions } from "../model/collisions";
import type { GroupingCourse } from "../model/grouping";
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
  const collisions = useCollisions(placements, catalog);
  const inspection = useCollisionInspection(collisions);
  const { hours, incompleteCount } = useHours(placements, catalog);

  function handleDrop(event: DragEndEvent) {
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
    <DragDropProvider plugins={PLUGINS} onDragEnd={handleDrop}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PlanSummaryBar planName={planName} incompleteCount={incompleteCount} />

        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]">
          <PlannerPalette groupings={groupings} names={names} hours={hours} />

          <div className="flex min-h-0 flex-col gap-3">
            {error && <ErrorBanner message={placementErrorMessage(error, names)} onDismiss={clearError} />}
            <div className="min-h-0 flex-1 overflow-auto">
              <PlannerGrid
                days={days}
                periods={periods}
                placements={placements}
                names={names}
                collisions={collisions}
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

function useCollisions(placements: LocalPlacement[], catalog: GroupingCourse[]) {
  const catalogById = useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
  return useMemo(() => deriveCellViolations(placements, catalogById), [placements, catalogById]);
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
