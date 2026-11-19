import type { Database, Json, SupabaseClient } from "@/shared/api";
import { generationJobRow } from "./generation-job-row";

type JobInsert = Database["public"]["Tables"]["generation_jobs"]["Insert"];

export type AddGenerationJobInput = {
  planId: string;
  /** Left out, the column default applies: `queued`. */
  status?: JobInsert["status"];
  /**
   * Who requested the job (S-407). The guard trigger lets the service role through, so the id given
   * is the id stored, and `null` makes a legacy job. Left out, the column default applies, which is
   * null for the service role too.
   */
  requestedBy?: string | null;
  /** Who first asked it to stop (S-407): stored as given, since the service role passes the guard. */
  stopRequestedBy?: string | null;
  /** The proposal the job clones into. A plan of the suite's own, so teardown removes it. */
  proposalPlanId?: string | null;
  /** "Email me when it finishes" (S-310). Left out, the column default applies: false. */
  emailRequested?: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  heartbeatAt?: string | null;
  /** The enqueue instant. Left out, the column default applies: now. */
  createdAt?: string;
  /** Free text the job email must never carry: set it to a sentinel to prove that. */
  error?: string | null;
  /** The stored result: the job email reads only `result -> diagnostics`. */
  result?: Json;
  /** The stored checkpoint, read only as `checkpoint -> diagnostics`, with its stage index. */
  checkpoint?: Json;
  checkpointStageIndex?: number | null;
  /** The stored policy, in any shape the column has held. Left out: `generationJobRow`'s legacy one. */
  policy?: Json;
};

/**
 * Insert one `generation_jobs` row (`generationJobRow`'s minimal snapshot) and return its id.
 * Direct input insert, with the service role, so every column given is stored as given. A plan holds
 * at most one `queued` or `running` job (`generation_jobs_active_per_plan`), so pass a terminal
 * `status` to leave that slot free.
 */
export async function addGenerationJob(supabase: SupabaseClient, input: AddGenerationJobInput): Promise<string> {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({ ...(await generationJobRow(input.planId)), ...columnsOf(input) })
    .select("id")
    .single();
  if (error) throw new Error(`addGenerationJob: ${error.message}`);
  return data.id;
}

/** Only the inputs given: an absent one leaves its column to the row's default. */
const columnsOf = (input: AddGenerationJobInput): Partial<JobInsert> =>
  Object.fromEntries(
    Object.entries({
      status: input.status,
      requested_by: input.requestedBy,
      stop_requested_by: input.stopRequestedBy,
      proposal_plan_id: input.proposalPlanId,
      email_requested: input.emailRequested,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      heartbeat_at: input.heartbeatAt,
      created_at: input.createdAt,
      error: input.error,
      result: input.result,
      checkpoint: input.checkpoint,
      checkpoint_stage_index: input.checkpointStageIndex,
      policy: input.policy,
    }).filter(([, value]) => value !== undefined),
  );
