import { useEffect, useMemo, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";
import ComputeGroupingsEmptyState from "@/components/planner/ComputeGroupingsEmptyState";
import GroupingBox from "@/components/planner/GroupingBox";
import GroupingFilter from "@/components/planner/GroupingFilter";
import PlannerGrid from "@/components/planner/PlannerGrid";
import type { CellData, DragData, LocalPlacement, PlannerBoardProps } from "@/components/planner/types";
import { createPlacement, deletePlacement } from "@/lib/planner/client";
import { deriveCollisions } from "@/lib/planner/collisions";
import { countIncompleteCourses, deriveHours } from "@/lib/planner/hours";

/**
 * Planner island root. Owns local placement state (seeded from props) and the palette
 * filter, hosts the DnD provider, and persists every drop optimistically with
 * temporary-id reconciliation. Drops always land (accept-and-flag); the only way to
 * remove a course is the chip's "×". Phase 4 layers the reactive collision/hours
 * derivations on top of this state.
 */
export default function PlannerBoard(props: PlannerBoardProps) {
  const { planId, variantId, cohortId, days, periods, groupings, names, catalog } = props;

  const [placements, setPlacements] = useState<LocalPlacement[]>(props.placements);
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Always read the latest committed placements inside async handlers — never a stale
  // closure snapshot (the known reactive-derivation footgun).
  const placementsRef = useRef(placements);
  useEffect(() => {
    placementsRef.current = placements;
  }, [placements]);

  const visibleGroupings = useMemo(
    () => (leadingCourseId ? groupings.filter((g) => g.memberIds.includes(leadingCourseId)) : groupings),
    [groupings, leadingCourseId],
  );

  // Reactive derivations over current placement state — recomputed on every change so a
  // collision flag clears the moment a participant leaves, and hours track live. Pure
  // and per-cell (O(occupants²)); no network on the validation path (≤200 ms budget).
  const catalogById = useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
  const collisions = useMemo(() => deriveCollisions(placements, catalogById), [placements, catalogById]);
  const hours = useMemo(() => deriveHours(placements, catalog), [placements, catalog]);
  const incompleteCount = useMemo(() => countIncompleteCourses(hours), [hours]);

  function addCourse(courseId: string, cell: CellData) {
    // placements_unique: a course sits at most once per cell — dropping a duplicate is a no-op.
    if (occupiesCell(placementsRef.current, courseId, cell)) return;

    const tempId = crypto.randomUUID();
    setPlacements((prev) => [...prev, { id: tempId, courseId, day: cell.day, period: cell.period, pending: true }]);

    createPlacement({ variantId, cohortId, courseId, day: cell.day, period: cell.period })
      .then((row) => {
        setPlacements((prev) => prev.map((p) => (p.id === tempId ? row : p)));
      })
      .catch((err: unknown) => {
        setPlacements((prev) => prev.filter((p) => p.id !== tempId));
        setError(messageOf(err));
      });
  }

  function movePlacement(placementId: string, cell: CellData) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending) return; // gated until the server id reconciles
    if (row.day === cell.day && row.period === cell.period) return; // same cell
    if (occupiesCell(placementsRef.current, row.courseId, cell)) return; // already there

    const oldId = row.id;
    const origin = { day: row.day, period: row.period };
    setPlacements((prev) =>
      prev.map((p) => (p.id === oldId ? { ...p, day: cell.day, period: cell.period, pending: true } : p)),
    );

    // Insert-before-delete: the new cell differs in (day, period) so it can't hit
    // placements_unique; if the POST fails nothing is lost.
    createPlacement({ variantId, cohortId, courseId: row.courseId, day: cell.day, period: cell.period })
      .then((created) => {
        setPlacements((prev) => prev.map((p) => (p.id === oldId ? created : p)));
        // Best-effort cleanup of the old row. A failure leaves a transient duplicate
        // (surfaced on reload), never a lost placement.
        deletePlacement(oldId).catch((err: unknown) => {
          setError(`Move saved but old cell cleanup failed: ${messageOf(err)}`);
        });
      })
      .catch((err: unknown) => {
        setPlacements((prev) =>
          prev.map((p) => (p.id === oldId ? { ...p, day: origin.day, period: origin.period, pending: false } : p)),
        );
        setError(messageOf(err));
      });
  }

  function removePlacement(placementId: string) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending) return; // gated until the server id reconciles

    setPlacements((prev) => prev.filter((p) => p.id !== placementId));
    deletePlacement(placementId).catch((err: unknown) => {
      setPlacements((prev) => [...prev, row]); // rollback
      setError(messageOf(err));
    });
  }

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
        <div
          data-slot="plan-summary"
          data-incomplete={incompleteCount}
          className="text-muted-foreground flex shrink-0 items-center gap-2 border-b px-6 py-2 text-sm"
        >
          {incompleteCount > 0 ? (
            <span>
              <span className="text-foreground font-medium tabular-nums">{incompleteCount}</span>{" "}
              {incompleteCount === 1 ? "course" : "courses"} left to place
            </span>
          ) : (
            <span className="text-foreground font-medium">All course hours placed</span>
          )}
        </div>

        <div data-slot="planner-board" className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]">
          <aside data-slot="planner-palette" className="flex min-h-0 flex-col gap-3">
            <div className="shrink-0">
              <GroupingFilter
                groupings={groupings}
                names={names}
                value={leadingCourseId}
                onChange={setLeadingCourseId}
              />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {visibleGroupings.map((grouping) => (
                <GroupingBox key={grouping.id} grouping={grouping} names={names} hours={hours} />
              ))}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col gap-3">
            {error && (
              <div
                role="alert"
                className="border-destructive/50 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                  }}
                  className="text-xs underline"
                >
                  Dismiss
                </button>
              </div>
            )}
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

const occupiesCell = (placements: LocalPlacement[], courseId: string, cell: CellData): boolean =>
  placements.some((p) => p.courseId === courseId && p.day === cell.day && p.period === cell.period);

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : "Unexpected error persisting placement";
