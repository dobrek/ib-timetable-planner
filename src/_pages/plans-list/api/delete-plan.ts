import { unwrapCompleted, type SupabaseClient } from "@/shared/api";
import type { DeletePlanInput } from "../model/schemas";

/**
 * Delete a plan by id. Cascades the entire scenario — catalog, placements, and
 * groupings — via the plan-rooted FK graph. The UI's confirm dialog names the
 * blast radius (entity counts) before this runs.
 */
export const deletePlan = async (supabase: SupabaseClient, input: DeletePlanInput) =>
  unwrapCompleted(await supabase.from("plans").delete().eq("id", input.id), "Failed to delete plan");
