import { z } from "zod";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";

/**
 * Stop & keep (S-305): the author asks a generation job to end, and keeps whatever the ladder has
 * already checkpointed.
 *
 * **This is the only legitimate stop writer.** The solver is barred at the grant layer — it holds
 * SELECT and deliberately NOT UPDATE on `stop_requested_at` (migration 20260820075348), so a
 * container that could clear its own flag cannot exist — and S-304 already refused every
 * session-free credential for row writes. What is left is exactly this: the author's own
 * authenticated request, through an Astro Action.
 *
 * **Two writes, and the order is the contract.** A `queued` row has no solver to ask, so it is
 * terminalised here, app-side; a `running` row is asked, by writing the flag the solver's heartbeat
 * polls. Done the other way round a queued row would get a flag nothing will ever read — the claim
 * CAS does not consult it — and then be terminalised anyway: two writes where one suffices, and an
 * audit trail that reads as though a solver ignored the request.
 *
 * **Stopping is a request, not an event.** On a running job this function returns the moment the
 * flag is durable; the row is still `running`. The solver observes the flag on its next heartbeat
 * (≤ 15 s) and then has to unwind the stage that is in flight, so the terminal row lands minutes
 * later, not seconds. Every caller must say so.
 *
 * **Losing a race is never an error.** A job that finished between the page's last poll and this
 * click matches neither write, and the honest answer is `already-finished` — the author gets the
 * full board, which is strictly better than what they asked for.
 *
 * It never touches `plans`. A stopped row with no checkpoint is `isSweepableJob`, so the clone is
 * deleted by `checkPlan`'s existing `settle` branch on the next visit — the same path a failed job
 * already takes. One sweeper, not two.
 */
export const stopGenerationInput = z.object({ jobId: z.uuid() });

export type StopGenerationInput = z.infer<typeof stopGenerationInput>;

/**
 * What the click actually did, so the UI can narrate it without re-reading the row.
 *
 * - `stopped` — the job had not started; it is terminal now, and kept nothing.
 * - `stopping` — the request is durable and the solver will act on it. The row is still `running`.
 * - `already-finished` — nothing to stop; the next poll tick tells the whole story.
 */
export type StopGenerationOutcome = "stopped" | "stopping" | "already-finished";

export type StopGenerationResult = { outcome: StopGenerationOutcome };

/** The author's own account of why a job that never started has no board. Written in the same
 *  vocabulary as the solver's `stopped by the author: …`, because both reach the same strip. */
const STOPPED_BEFORE_START =
  "stopped by the author: the solve was stopped before any stage finished — nothing was kept";

export const stopGeneration = async (
  supabase: SupabaseClient,
  input: StopGenerationInput,
): Promise<StopGenerationResult> => {
  if (await terminaliseQueued(supabase, input.jobId)) return { outcome: "stopped" };
  return { outcome: (await requestStop(supabase, input.jobId)) ? "stopping" : "already-finished" };
};

/**
 * The `queued → stopped` compare-and-set: true iff this call is what terminalised the row.
 *
 * A queued job has no solver holding it — nothing has claimed it — so there is nobody to ask and
 * nothing to keep. Writing the flag alongside the terminal status is deliberate: it records that a
 * human asked, which is the difference between this row and one S-304's reclaim swept.
 *
 * The CAS filter is what makes this safe against a solver claiming the row in the same millisecond.
 * A lost CAS falls through to the flag write, which is exactly right — the row is `running` now.
 */
const terminaliseQueued = async (supabase: SupabaseClient, jobId: string): Promise<boolean> => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("generation_jobs")
    .update({
      status: "stopped",
      error: STOPPED_BEFORE_START,
      finished_at: now,
      stop_requested_at: now,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    // `select` is what makes a matched-nothing observable: PostgREST answers 204 without it, and a
    // lost CAS would be indistinguishable from a won one.
    .select("id");
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to stop the generation job: ${error.message}`);
  }
  return data.length > 0;
};

/**
 * The flag write: true iff a running row now carries the author's stop request.
 *
 * Filtered to `running` and never to `queued`. The CAS above has already failed to match `queued`,
 * and no transition anywhere returns a row to it, so the only thing a `queued` filter could catch is
 * a row that has since been claimed — which `running` catches anyway. Matching nothing means the job
 * reached a terminal status first: benign, and the caller says so.
 *
 * Idempotent by construction. Clicking twice re-stamps the instant; the solver's poll asks only
 * whether the column is non-null, and its own latch is first-writer-wins.
 */
const requestStop = async (supabase: SupabaseClient, jobId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .update({ stop_requested_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "running")
    .select("id");
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to request a stop for the generation job: ${error.message}`);
  }
  return data.length > 0;
};
