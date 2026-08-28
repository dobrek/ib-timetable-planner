import type { SupabaseClient } from "@/shared/api";
import { isStaleActiveJob, stalenessCutoff, type GenerationJobStatus } from "@/entities/timetable";

/**
 * The fail-forward reclaim: move a gone-quiet `queued`/`running` row to `interrupted` so the author is
 * unblocked (S-304).
 *
 * **One writer, two callers.** The plan visit (`checkPlan`) is the authoritative one — it also
 * delivers whatever checkpoint the dead solve left behind. The enqueue path (`startGeneration`) is the
 * backstop for the race the visit cannot cover: an author who clicks Generate before ever loading the
 * plan page hits the partial unique index instead, and that `23505` is where the wedge is felt. Both
 * call THIS, so the two can never disagree about what stale means or what a reclaim writes.
 *
 * **Reclaim, never re-queue.** The row goes `running → interrupted`, and the author starts a fresh
 * job. That is deliberately not the redispatch the roadmap sketched: redispatch would need the claim
 * CAS widened past `status=eq.queued`, which is the only idempotency guard that survives a container
 * restart (F-302's B5). Under fail-forward the existing filters do exactly what they were built for —
 * a zombie container's late `progress` matches no row and its `finish` falls outside the solver's RLS
 * window — so the invariant survives intact instead of being traded away.
 *
 * **A lost CAS is not an error.** It means a heartbeat landed between the read and the write: the job
 * is alive after all, and the caller's existing view is the right answer. No retry — the next visit
 * re-decides against a fresher clock.
 */
export type ReclaimableRow = {
  id: string;
  status: GenerationJobStatus;
  heartbeat_at: string | null;
  created_at: string;
};

/** What the reclaim wrote, so a caller can update its in-memory row without re-reading. */
export type Reclaim = {
  error: string;
  finishedAt: string;
};

export const reclaimStaleJob = async (
  supabase: SupabaseClient,
  row: ReclaimableRow,
  nowMs: number = Date.now(),
): Promise<Reclaim | null> => {
  if (!isStaleActiveJob(row, nowMs)) return null;

  const cutoff = stalenessCutoff(nowMs);
  const finishedAt = new Date(nowMs).toISOString();
  const error = reclaimReason(row, cutoff);

  const update = supabase
    .from("generation_jobs")
    .update({ status: "interrupted", error, finished_at: finishedAt })
    .eq("id", row.id)
    // The guard, and the reason this is safe at all: each branch pins BOTH the status observed and
    // the clock judged by, so a solve that renewed a millisecond ago cannot lose its row to a
    // decision taken a millisecond before that.
    .eq("status", row.status);

  const guarded =
    row.status === "running"
      ? // A null `heartbeat_at` on a running row is stale on sight (the claim writes one), but `lt`
        // against NULL is NULL, so the null case has to be said out loud. The instant is
        // DOUBLE-QUOTED because `:` and `.` are reserved inside PostgREST's logical tree — an
        // unquoted ISO-8601 parses there differently than it does in a bare filter.
        update.or(`heartbeat_at.is.null,heartbeat_at.lt."${cutoff}"`)
      : update.lt("created_at", cutoff);

  // `select` is what makes a matched-nothing observable: without it PostgREST answers 204 whether it
  // matched the row or nothing at all, and a lost CAS would be indistinguishable from a won one.
  const { data, error: failure } = await guarded.select("id");
  if (failure) {
    // Not fatal. The caller can still render or throw as it would have; the next visit tries again.
    // eslint-disable-next-line no-console
    console.error(`[reclaimStaleJob] could not reclaim stale job ${row.id}:`, failure.message);
    return null;
  }
  return data.length === 0 ? null : { error, finishedAt };
};

/** Say which clock ran out and what it last read — the author's only account of a silent death. */
const reclaimReason = (row: ReclaimableRow, cutoff: string): string =>
  row.status === "running"
    ? `interrupted: the solver stopped reporting. The last heartbeat was ${row.heartbeat_at ?? "never recorded"}, ` +
      `older than the ${cutoff} staleness cutoff — the container was almost certainly replaced or killed mid-solve.`
    : `interrupted: no solver ever claimed this job. It has been queued since ${row.created_at}, ` +
      `older than the ${cutoff} staleness cutoff — the dispatch never reached a solver.`;
