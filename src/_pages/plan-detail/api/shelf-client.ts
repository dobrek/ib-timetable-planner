import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";
import type { ParkedBundle, ParkedMember } from "../model/placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";
import { callActionData } from "./call-action";

/** Lift the bundle at a cell off the board into the shelf; returns the new parked card (empty members). */
export function shelveBundle(args: {
  planId: string;
  cohort: Cohort;
  day: number;
  period: number;
}): Promise<ParkedBundle> {
  return callActionData(actions.shelveBundle, args);
}

/** Place a parked bundle's courses back at a target cell (merge if occupied); returns the resulting placements. */
export function unshelveBundle(args: {
  planId: string;
  cohort: Cohort;
  shelfBundleId: string;
  targetDay: number;
  targetPeriod: number;
}): Promise<PlannerPlacement[]> {
  return callActionData(actions.unshelveBundle, args);
}

/** Discard a parked bundle outright (the card's "×"). */
export function deleteShelfBundle(args: { planId: string; shelfBundleId: string }): Promise<void> {
  return callActionData(actions.deleteShelfBundle, args);
}

/** Park an arbitrary course-set directly (a palette grouping never placed on the board). */
export function shelveCourses(args: {
  planId: string;
  cohort: Cohort;
  members: ParkedMember[];
}): Promise<ParkedBundle> {
  return callActionData(actions.shelveCourses, args);
}
