import { actions } from "astro:actions";
import type { Cohort, PlacementWeek } from "@/shared/config";
import type { PlannerPlacement } from "../model/placement";

/** Place one course-hour (creating the cell's bundle if absent). Single add + group add (per member) both call this. */
export async function placeCourse(args: {
  planId: string;
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
}): Promise<PlannerPlacement> {
  const { data, error } = await actions.placeCourse(args);
  if (error) throw new Error(error.message);
  return data;
}

/** Move a member-set (course ids) from a source cell to a target cell — single move, whole-bundle move, and merge. */
export async function moveBundleMembers(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
  courseIds: string[];
  targetDay: number;
  targetPeriod: number;
}): Promise<PlannerPlacement[]> {
  const { data, error } = await actions.moveBundleMembers(args);
  if (error) throw new Error(error.message);
  return data;
}

/** Remove a member-set (course ids) from a cell — single remove and whole-bundle remove. */
export async function removeBundleMembers(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
  courseIds: string[];
}): Promise<void> {
  const { error } = await actions.removeBundleMembers(args);
  if (error) throw new Error(error.message);
}

export async function updatePlacementWeek(id: string, week: PlacementWeek): Promise<PlannerPlacement> {
  const { data, error } = await actions.updatePlacementWeek({ id, week });
  if (error) throw new Error(error.message);
  return data;
}
