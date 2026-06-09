import { useMemo, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import ErrorBanner from "./ErrorBanner";
import PlanSummaryBar from "./PlanSummaryBar";
import PlannerGrid from "./PlannerGrid";
import PlannerPalette from "./PlannerPalette";
import type { CellData, DragData, PlannerBoardProps } from "@/_pages/plan-detail/model/types";
import { usePlacements } from "@/_pages/plan-detail/model/usePlacements";
import { deriveCollisions } from "@/_pages/plan-detail/model/collisions";
import { countIncompleteCourses, deriveHours } from "@/_pages/plan-detail/model/hours";

/**
 * Planner island root: a thin composition over `usePlacements` (state + optimistic
 * persistence), the reactive collision/hours derivations, and the palette/grid views.
 * Drops always land (accept-and-flag); the only way to remove a course is the chip's "×".
 */
export default function PlannerBoard(props: PlannerBoardProps) {
  const { planId, variantId, cohortId, days, periods, groupings, names, catalog } = props;

  const { placements, error, addCourse, movePlacement, removePlacement, clearError } = usePlacements(props.placements, {
    variantId,
    cohortId,
  });
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);

  // Reactive derivations over current placement state — recomputed on every change so a
  // collision flag clears the moment a participant leaves, and hours track live. Pure
  // and per-cell (O(occupants²)); no network on the validation path (≤200 ms budget).
  const catalogById = useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
  const collisions = useMemo(() => deriveCollisions(placements, catalogById), [placements, catalogById]);
  const hours = useMemo(() => deriveHours(placements, catalog), [placements, catalog]);
  const incompleteCount = useMemo(() => countIncompleteCourses(hours), [hours]);

  function handleDrop(event: DragEndEvent) {
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return; // dropped outside any cell — no-op (removal is via "×")

    const data = source.data as DragData;
    const cell = target.data as CellData;
    if (data.kind === "course") addCourse(data.courseId, cell);
    else movePlacement(data.placementId, cell);
  }

  if (groupings.length === 0) {
    return (
      <div data-slot="planner-board" className="p-6">
        <ComputeGroupingsEmptyState planId={planId} cohortId={cohortId} />
      </div>
    );
  }

  return (
    <DragDropProvider plugins={PLUGINS} onDragEnd={handleDrop}>
      <div className="flex min-h-0 flex-1 flex-col">
        <PlanSummaryBar incompleteCount={incompleteCount} />

        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]">
          <PlannerPalette
            groupings={groupings}
            names={names}
            hours={hours}
            leadingCourseId={leadingCourseId}
            onLeadingChange={setLeadingCourseId}
          />

          <div className="flex min-h-0 flex-col gap-3">
            {error && <ErrorBanner message={error} onDismiss={clearError} />}
            <div className="min-h-0 flex-1 overflow-auto">
              <PlannerGrid
                days={days}
                periods={periods}
                placements={placements}
                names={names}
                collisions={collisions}
                onRemove={removePlacement}
              />
            </div>
          </div>
        </div>
      </div>
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
