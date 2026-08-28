import { unwrapMany, type SupabaseClient } from "@/shared/api";
import { toGenerationIndicators, type GenerationIndicator } from "../model/plan-indicators";
import type { ReadGenerationJobStatusesInput } from "../model/schemas";

/**
 * A status-only read of `generation_jobs` — the hub's poll, and nothing more.
 *
 * **It never delivers.** `checkPlan` (plan-detail) is not a passive read: on a succeeded,
 * undelivered job it verifies the board server-side, translates it into the clone's id space and
 * applies it. Polling THAT from a hub tab would run delivery on a schedule, from a page the author
 * is not even looking at, and race every other open tab doing the same. This function reads six
 * columns and returns; delivery stays where the author's visit triggers it.
 *
 * **Two ways in, because the author has two tabs.** `jobIds` refreshes what the caller already knows
 * about — the common tick. `planIds` DISCOVERS: a hub left open when Generate was pressed on a plan
 * page has no job id to ask about, and without this it would show nothing until a reload. The refresh
 * read is unfiltered by status, because a terminal row is precisely how the poll learns a job ended;
 * the discovery read is `surfacedJobsFor`, whose filter S-306 widened from active-only to "anything
 * this page should be badging" — see that function.
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
export const STATUS_COLUMNS =
  "id, plan_id, proposal_plan_id, delivered_plan_id, status, stage_index, stage_name, created_at, heartbeat_at";

export const readGenerationJobStatuses = async (
  supabase: SupabaseClient,
  input: ReadGenerationJobStatusesInput,
): Promise<GenerationIndicator[]> => {
  const [byJob, byPlan] = await Promise.all([
    refreshKnown(supabase, input.jobIds),
    surfacedJobsFor(supabase, input.planIds),
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

/**
 * Every job these plans should be showing a badge for — the ONE definition of "surfaced", shared by
 * the SSR loader and by the poll's discovery read so the first paint and the first tick cannot
 * disagree about which rows exist.
 *
 * Three kinds of row qualify, and each answers a different question the author has:
 *
 *   1. **Active** (`queued`/`running`) — a solve is happening. The original member.
 *   2. **Terminal but undelivered** — a board is waiting for a visit to land it. Without this the
 *      badge would vanish the instant the solver finished, and the author would have no signal that
 *      anything is ready until they happened to open a plan.
 *   3. **Delivered but not yet announced** (`notified_at is null`) — this is what makes "Ready — open"
 *      survive a reload. Before S-306 terminal memory lived only in the poll store's RAM, so a
 *      refresh erased it; now it is a row state, and `checkPlan` stamps `notified_at` the first time
 *      the author actually looks at the delivered proposal.
 *
 * Matched on `plan_id` OR `proposal_plan_id`: the hub knows the ids of the rows ON THE PAGE, and a
 * job's badge may belong to either of its two plans depending on which of them the page is showing.
 */
export const surfacedJobsFor = async (
  supabase: SupabaseClient,
  planIds: readonly string[],
): Promise<GenerationIndicator[]> => {
  if (planIds.length === 0) return [];
  const ids = `(${planIds.join(",")})`;
  return toGenerationIndicators(
    unwrapMany(
      await supabase
        .from("generation_jobs")
        .select(STATUS_COLUMNS)
        .or(`plan_id.in.${ids},proposal_plan_id.in.${ids}`)
        .or(
          "status.in.(queued,running)," +
            "and(delivered_plan_id.is.null,status.in.(succeeded,interrupted,stopped))," +
            "and(delivered_plan_id.not.is.null,notified_at.is.null)",
        ),
      "Generation activity lookup failed",
    ),
  );
};

/** The two reads can name the same row — a known job that is also still active. Keep one. */
const dedupeByJobId = (indicators: GenerationIndicator[]): GenerationIndicator[] => [
  ...new Map(indicators.map((indicator) => [indicator.jobId, indicator])).values(),
];
