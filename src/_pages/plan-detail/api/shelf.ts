import { z } from "zod";
import { dayField, periodField, toPlannerPlacement } from "./placements";
import type { ParkedBundle } from "../model/placement/parked";
import type { PlannerPlacement } from "../model/placement/placement";
import type { SupabaseClient } from "@/shared/api";
import { cohortSchema, placementWeekSchema } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";

type Supabase = SupabaseClient;

/** Lift the bundle at a cell off the board into the shelf. */
export const shelveBundleInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  day: dayField,
  period: periodField,
});

/** Place a parked bundle's courses back at a target cell (merge if occupied). */
export const unshelveBundleInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  shelfBundleId: z.uuid(),
  targetDay: dayField,
  targetPeriod: periodField,
});

/** Discard a parked bundle outright (the card's "×"). */
export const deleteShelfBundleInput = z.object({
  planId: z.uuid(),
  shelfBundleId: z.uuid(),
});

/** Park an arbitrary course-set directly (e.g. a palette grouping never placed on the board). */
export const shelveCoursesInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  members: z.array(z.object({ courseId: z.uuid(), week: placementWeekSchema })).min(1),
});

export type ShelveBundleInput = z.infer<typeof shelveBundleInput>;
export type UnshelveBundleInput = z.infer<typeof unshelveBundleInput>;
export type DeleteShelfBundleInput = z.infer<typeof deleteShelfBundleInput>;
export type ShelveCoursesInput = z.infer<typeof shelveCoursesInput>;

/**
 * Lift the placed bundle at a cell off the board, capturing its courses + weeks into the
 * shelf, via the atomic `shelve_bundle` RPC. Returns the new shelf header projected to a
 * `ParkedBundle` with empty `members` — the client already holds the parked course set
 * (it read the cell occupants) and reconciles the card's id from this header.
 */
export const shelveBundle = async (supabase: Supabase, input: ShelveBundleInput): Promise<ParkedBundle> => {
  const { data, error } = await supabase.rpc("shelve_bundle", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_day: input.day,
    p_period: input.period,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to shelve bundle: ${error.message}`);
  return { id: data.id, members: [] };
};

/**
 * Place a parked bundle's courses back at the target cell (find-or-create merge) and drop
 * the shelf row, via the atomic `unshelve_bundle` RPC. Returns the resulting placements so
 * the client reconciles its optimistic temp ids by course id.
 */
export const unshelveBundle = async (supabase: Supabase, input: UnshelveBundleInput): Promise<PlannerPlacement[]> => {
  const { data, error } = await supabase.rpc("unshelve_bundle", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_shelf_bundle_id: input.shelfBundleId,
    p_target_day: input.targetDay,
    p_target_period: input.targetPeriod,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to unshelve bundle: ${error.message}`);
  return data.map(toPlannerPlacement);
};

/**
 * Discard a parked bundle (header + its courses cascade) via the `delete_shelf_bundle` RPC.
 * Pinned by (plan_id, shelf_bundle_id) — no cohort arg. A single-card discard, never the
 * out-of-scope "clear shelf" bulk action.
 */
export const deleteShelfBundle = async (supabase: Supabase, input: DeleteShelfBundleInput): Promise<void> => {
  const { error } = await supabase.rpc("delete_shelf_bundle", {
    p_plan_id: input.planId,
    p_shelf_bundle_id: input.shelfBundleId,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete shelf bundle: ${error.message}`);
};

/**
 * Park an arbitrary course-set onto the shelf via the `shelve_courses` RPC — the off-board
 * analogue of `shelveBundle`, for parking a palette grouping that was never placed. Returns the
 * new parked bundle; its members are the ones we sent (the server stored exactly those).
 */
export const shelveCourses = async (supabase: Supabase, input: ShelveCoursesInput): Promise<ParkedBundle> => {
  const { data, error } = await supabase.rpc("shelve_courses", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_course_ids: input.members.map((member) => member.courseId),
    p_weeks: input.members.map((member) => member.week),
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to shelve courses: ${error.message}`);
  return { id: data.id, members: input.members };
};
