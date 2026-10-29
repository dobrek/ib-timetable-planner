import { unwrapRow, type Database, type SupabaseClient } from "@/shared/api";
import type { MarkCurrentPlanInput } from "../model/schemas";
import { assertNotPending } from "./pending-guards";

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/**
 * Make a plan the current one (S-404, FR-420): the plan the school is using, which every user sees
 * marked on the hub and on the plan itself. At most one plan is current, so marking one unmarks the
 * plan that held it.
 *
 * Refused while the plan is a pending proposal. It has no board yet, the perspective and comparison
 * views refuse it, delivery replaces its board, and the system sweeps may delete it (research §3),
 * so viewers would be told to read a plan they cannot open, and the marker could vanish with no
 * author acting. The database refuses it too (`plans_current_not_pending`). A delivered proposal is
 * an ordinary plan and may be marked: that is the adopt step. A clone or a fresh proposal never
 * inherits the marker, because `clone_plan` does not copy the column.
 *
 * `set_current_plan` is the race-free write: it re-checks the flag under a row lock, so a plan that
 * becomes pending between the guard's read and the call returns no row and surfaces as "Plan not
 * found.", as in `renamePlan`. Two movers are serialised in the database and the later one wins, so
 * the `conflict` message is a defence only.
 */
export const markCurrentPlan = async (supabase: SupabaseClient, input: MarkCurrentPlanInput): Promise<PlanRecord> => {
  await assertNotPending(supabase, input.id);
  return unwrapRow(await supabase.rpc("set_current_plan", { p_plan_id: input.id }).single(), {
    notFound: "Plan not found.",
    conflict: "Another author just changed the current plan. Refresh and try again.",
    failure: "Failed to mark the plan current",
  });
};
