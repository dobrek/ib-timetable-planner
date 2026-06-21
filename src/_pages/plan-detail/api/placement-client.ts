import { actions } from "astro:actions";
import type { Cohort, PlacementWeek } from "@/shared/config";
import type { PlannerPlacement } from "../model/placement";

export async function createPlacement(args: {
  planId: string;
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
}): Promise<PlannerPlacement> {
  const { data, error } = await actions.createPlacement(args);
  if (error) throw new Error(error.message);
  return data;
}

export async function deletePlacement(id: string): Promise<void> {
  const { error } = await actions.deletePlacement({ id });
  if (error) throw new Error(error.message);
}

export async function updatePlacementWeek(id: string, week: PlacementWeek): Promise<PlannerPlacement> {
  const { data, error } = await actions.updatePlacementWeek({ id, week });
  if (error) throw new Error(error.message);
  return data;
}
