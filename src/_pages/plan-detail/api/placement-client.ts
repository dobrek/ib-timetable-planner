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
