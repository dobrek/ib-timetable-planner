import { unwrapRow, type Database, type SupabaseClient } from "@/shared/api";
import type { UnmarkCurrentPlanInput } from "../model/schemas";

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/**
 * Clear the current-plan marker from the plan that holds it, so no plan is current: the way back to
 * "nothing is official yet" (FR-420 allows zero).
 *
 * A plain update, not an RPC: clearing can never make a second plan current, so it needs neither
 * `set_current_plan`'s lock nor its ordering. It writes `is_current` alone, which is what keeps
 * "Last updated" unchanged (the trigger's condition, `20261029143936_current_plan_marker.sql`).
 *
 * The `is_current` filter makes it race-free: a plan another author has meanwhile unmarked, or
 * moved the marker away from, matches no row and is reported as such rather than as a success.
 */
export const unmarkCurrentPlan = async (supabase: SupabaseClient, input: UnmarkCurrentPlanInput): Promise<PlanRecord> =>
  unwrapRow(
    await supabase
      .from("plans")
      .update({ is_current: false })
      .eq("id", input.id)
      .eq("is_current", true)
      .select()
      .single(),
    {
      notFound: "This plan is no longer the current plan. Refresh to see which one is.",
      failure: "Failed to unmark the current plan",
    },
  );
