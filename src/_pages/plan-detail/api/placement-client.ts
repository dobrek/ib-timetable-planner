import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";
import type { PlannerPlacement } from "../model/placement";

export async function createPlacement(args: {
  planId: string;
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
}): Promise<PlannerPlacement> {
  const { data, error } = await actions.createPlacement(args);
  if (error) throw new Error(error.message);
  return data;
}

export async function deletePlacement(id: string): Promise<void> {
  const { error } = await actions.deletePlacement({ id });
  if (error) throw new Error(error.message);
}
