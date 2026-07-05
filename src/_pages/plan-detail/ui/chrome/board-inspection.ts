import { useState } from "react";
import type { PlacementWeek } from "@/shared/config";
import {
  type CellCollisions,
  cellKey,
  type CollisionInspectionTarget,
  type LocalPlacement,
} from "@/entities/timetable";

/**
 * The collision-details dialog's active-inspection state and its two pure selectors, lifted out of
 * `PlannerBoard` so the single-cohort board and the combined shell derive the dialog's violations +
 * same-week hint from ONE place (no drift). Stays in the UI layer — not `model/` — because
 * `CollisionInspectionTarget` is a UI-dialog type and a `model → ui` import is forbidden by FSD.
 */

// Owns the single inspected cell for the single-cohort board. The collision map is a reactive
// derivation; if the inspected cell's violations vanish while the dialog is open (participant moved
// or removed elsewhere, server reconciliation), close rather than show stale content. Adjust-state-
// during-render (not an effect) so the close lands in the same render as the recompute. The combined
// shell tracks its own `{cohort, target}` (it must choose which cohort's map to check) but reuses
// the two selectors below.
export function useCollisionInspection(collisions: Map<string, CellCollisions>) {
  const [target, setTarget] = useState<CollisionInspectionTarget | null>(null);

  if (target && !collisions.has(cellKey(target.day, target.period))) setTarget(null);

  return {
    target,
    open: setTarget,
    close: () => {
      setTarget(null);
    },
  };
}

export const inspectedViolations = (
  target: CollisionInspectionTarget | null,
  collisions: Map<string, CellCollisions>,
) => (target ? (collisions.get(cellKey(target.day, target.period))?.violations ?? []) : []);

// The inspected cell's placement weeks (courseId → week), for the dialog's same-week hint.
export const inspectedWeeks = (
  target: CollisionInspectionTarget | null,
  placements: LocalPlacement[],
): Record<string, PlacementWeek> => {
  if (!target) return {};
  const weeks: Record<string, PlacementWeek> = {};
  for (const placement of placements)
    if (placement.day === target.day && placement.period === target.period) weeks[placement.courseId] = placement.week;
  return weeks;
};
