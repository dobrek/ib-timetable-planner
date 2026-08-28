import { unwrapCompleted, type SupabaseClient } from "@/shared/api";
import type { DeletePlanInput } from "../model/schemas";
import { assertNoActiveJob, assertNotPending } from "./pending-guards";

/**
 * Delete a plan by id. Cascades the entire scenario — catalog, placements, and
 * groupings — via the plan-rooted FK graph. The UI's confirm dialog names the
 * blast radius (entity counts) before this runs.
 *
 * Two S-306 guards, because a plan can be on either side of a generation and both sides break:
 *
 *   * As a **proposal**, delete is refused while the job is live, and while a board is ready but
 *     undelivered — "open it to deliver first". A failed, swept-shape or stale job releases it, and
 *     so does the absence of any job at all, so a wedged proposal can always be removed by hand.
 *   * As a **source**, delete is refused while its job is live. `plan_id` cascades, so this deletion
 *     would take the job row with it and strand the clone pending with nothing left to un-pend it.
 *
 * `allowTerminal` is what separates the two proposal cases: the plan-scoped ROUTES refuse a pending
 * proposal outright, but delete is the one act that must survive a broken job — it is the only way
 * out of a stranded row.
 */
export const deletePlan = async (supabase: SupabaseClient, input: DeletePlanInput): Promise<void> => {
  await assertNotPending(supabase, input.id, { allowTerminal: true });
  await assertNoActiveJob(supabase, input.id);
  unwrapCompleted(await supabase.from("plans").delete().eq("id", input.id), "Failed to delete plan");
};
