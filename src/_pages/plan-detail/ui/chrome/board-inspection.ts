import type { PlacementWeek } from "@/shared/config";
import {
  type CellCollisions,
  cellKey,
  type CollisionInspectionTarget,
  type LocalPlacement,
} from "@/entities/timetable";

/**
 * The collision-details dialog's two pure selectors, lifted out of `PlannerBoard` so every caller
 * derives the dialog's violations + same-week hint from ONE place (no drift). The inspected cell
 * itself is owned by the caller — `PlannerBoard` tracks `{cohort, target}` with its own `useState`,
 * because it must choose which cohort's collision map to read.
 *
 * Stays in the UI layer — not `model/` — because `CollisionInspectionTarget` is a UI-dialog type and
 * a `model → ui` import is forbidden by FSD.
 */

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
