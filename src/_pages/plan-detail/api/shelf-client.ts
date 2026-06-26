import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";
import type { ParkedBundle } from "../model/parked";
import type { PlannerPlacement } from "../model/placement";

/** Lift the bundle at a cell off the board into the shelf; returns the new parked card (empty members). */
export async function shelveBundle(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
}): Promise<ParkedBundle> {
  const { data, error } = await actions.shelveBundle(args);
  if (error) throw new Error(error.message);
  return data;
}

/** Place a parked bundle's courses back at a target cell (merge if occupied); returns the resulting placements. */
export async function unshelveBundle(args: {
  planId: string;
  cohort: Cohort;
  shelfBundleId: string;
  targetDay: number;
  targetPeriod: number;
}): Promise<PlannerPlacement[]> {
  const { data, error } = await actions.unshelveBundle(args);
  if (error) throw new Error(error.message);
  return data;
}

/** Discard a parked bundle outright (the card's "×"). */
export async function deleteShelfBundle(args: { planId: string; shelfBundleId: string }): Promise<void> {
  const { error } = await actions.deleteShelfBundle(args);
  if (error) throw new Error(error.message);
}
