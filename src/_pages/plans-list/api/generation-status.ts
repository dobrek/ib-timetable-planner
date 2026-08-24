import { unwrapMany, type SupabaseClient } from "@/shared/api";
import { toGenerationIndicators, type GenerationIndicator } from "../model/plan-indicators";
import type { ReadGenerationJobStatusesInput } from "../model/schemas";

/**
 * A status-only read of `generation_jobs` — the hub's poll, and nothing more.
 *
 * **It never delivers.** `checkGeneration` (plan-detail) is not a passive read: on a succeeded,
 * undelivered job it verifies the board server-side, translates it into the clone's id space and
 * applies it. Polling THAT from a hub tab would run delivery on a schedule, from a page the author
 * is not even looking at, and race every other open tab doing the same. This function reads six
 * columns and returns; delivery stays where the author's visit triggers it.
 *
 * **Two ways in, because the author has two tabs.** `jobIds` refreshes what the caller already knows
 * about — the common tick. `planIds` DISCOVERS: a hub left open when Generate was pressed on a plan
 * page has no job id to ask about, and without this it would show nothing until a reload. The
 * discovery read is active-only; the refresh read is not, because a terminal row is precisely how the
 * poll learns a job ended.
 *
 * The projection is explicit on both paths. `snapshot` is ~124 KB and TOASTed, `result` and
 * `checkpoint` ~35 KB each: a bare `select()` on a 5-second timer would be a standing transfer of
 * hundreds of kilobytes to render one line of text.
 *
 * **`heartbeat_at` earns its place in that projection (S-304), and it changes nothing else.** It is a
 * scalar, and it is what lets the hub say "stalled" about a job whose container died — the one thing
 * this poll can honestly contribute to recovery without writing. The reclaim itself belongs to the
 * plan visit the stalled badge links to, which is also where the dead solve's checkpoint is delivered.
 */
export const STATUS_COLUMNS = "id, plan_id, status, stage_index, stage_name, created_at, heartbeat_at";

export const readGenerationJobStatuses = async (
  supabase: SupabaseClient,
  input: ReadGenerationJobStatusesInput,
): Promise<GenerationIndicator[]> => {
  const [byJob, byPlan] = await Promise.all([
    refreshKnown(supabase, input.jobIds),
    discoverActive(supabase, input.planIds),
  ]);
  return dedupeByJobId([...byJob, ...byPlan]);
};

/** The rows the caller named, whatever state they are in — a terminal one is the answer, not a miss. */
const refreshKnown = async (supabase: SupabaseClient, jobIds: string[]): Promise<GenerationIndicator[]> => {
  if (jobIds.length === 0) return [];
  return toGenerationIndicators(
    unwrapMany(
      await supabase.from("generation_jobs").select(STATUS_COLUMNS).in("id", jobIds),
      "Generation status lookup failed",
    ),
  );
};

/** Any job that has since STARTED on these plans. At most one per plan, by the partial unique index. */
const discoverActive = async (supabase: SupabaseClient, planIds: string[]): Promise<GenerationIndicator[]> => {
  if (planIds.length === 0) return [];
  return toGenerationIndicators(
    unwrapMany(
      await supabase
        .from("generation_jobs")
        .select(STATUS_COLUMNS)
        .in("status", ["queued", "running"])
        .in("plan_id", planIds),
      "Generation activity lookup failed",
    ),
  );
};

/** The two reads can name the same row — a known job that is also still active. Keep one. */
const dedupeByJobId = (indicators: GenerationIndicator[]): GenerationIndicator[] => [
  ...new Map(indicators.map((indicator) => [indicator.jobId, indicator])).values(),
];
