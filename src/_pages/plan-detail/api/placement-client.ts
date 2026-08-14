import { actions } from "astro:actions";
import type { Cohort, PlacementWeek } from "@/shared/config";
import type { PlannerPlacement } from "@/entities/timetable";
import { callActionData } from "./call-action";

/** Place one course-hour (creating the cell's bundle if absent). Single add + group add (per member) both call this. */
export function placeCourse(args: {
  planId: string;
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
  isOptional: boolean;
}): Promise<PlannerPlacement> {
  return callActionData(actions.placeCourse, args);
}

/** Move a member-set (course ids) from a source cell to a target cell — single move, whole-bundle move, and merge. */
export function moveBundleMembers(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
  courseIds: string[];
  targetDay: number;
  targetPeriod: number;
}): Promise<PlannerPlacement[]> {
  return callActionData(actions.moveBundleMembers, args);
}

/** Remove a member-set (course ids) from a cell — single remove and whole-bundle remove. */
export function removeBundleMembers(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
  courseIds: string[];
}): Promise<void> {
  return callActionData(actions.removeBundleMembers, args);
}

export function updatePlacementWeek(id: string, week: PlacementWeek): Promise<PlannerPlacement> {
  return callActionData(actions.updatePlacementWeek, { id, week });
}

export function updatePlacementOptional(id: string, isOptional: boolean): Promise<PlannerPlacement> {
  return callActionData(actions.updatePlacementOptional, { id, isOptional });
}

/**
 * Atomic region replace for plan generation (one call may carry both cohorts; see `placements.ts`).
 *
 * Its forward caller is gone — S-301 moved Generate onto a server-side CP-SAT job, which lands its
 * board through the DOMAIN function of the same name (`api/placements.ts`, via
 * `generation-delivery.ts`), never through this client wrapper. What keeps this alive is the
 * UNDO/REDO path: `rpcs.ts`'s `applyGeneratedRegion` binds it per-cohort so reconciling a generated
 * batch replays as one region write.
 */
export function applyGeneratedPlacements(args: {
  planId: string;
  cells: { cohort: Cohort; day: number; period: number }[];
  placements: {
    cohort: Cohort;
    courseId: string;
    day: number;
    period: number;
    week: PlacementWeek;
    isOptional: boolean;
  }[];
}): Promise<{ dp1: PlannerPlacement[]; dp2: PlannerPlacement[] }> {
  return callActionData(actions.applyGeneratedPlacements, args);
}
