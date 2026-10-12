import type { Database, SupabaseClient } from "@/shared/api";
import { generationJobRow } from "./generation-job-row";

export type AddGenerationJobInput = {
  planId: string;
  /** Left out, the column default applies: `queued`. */
  status?: Database["public"]["Tables"]["generation_jobs"]["Insert"]["status"];
};

/**
 * Insert one `generation_jobs` row (`generationJobRow`'s minimal snapshot) and return its id.
 * Direct input insert. A plan holds at most one `queued` or `running` job
 * (`generation_jobs_active_per_plan`), so pass a terminal `status` to leave that slot free.
 */
export async function addGenerationJob(supabase: SupabaseClient, input: AddGenerationJobInput): Promise<string> {
  const { planId, status } = input;
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({ ...(await generationJobRow(planId)), status })
    .select("id")
    .single();
  if (error) throw new Error(`addGenerationJob: ${error.message}`);
  return data.id;
}
