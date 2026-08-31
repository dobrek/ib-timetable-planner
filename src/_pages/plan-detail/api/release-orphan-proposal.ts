import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { stalenessCutoff } from "@/entities/timetable";

/**
 * Un-pend a proposal plan that no job row references any more — the stranded orphan's way out.
 *
 * **Precondition: the caller has established that no job names this plan.** The plan route calls it
 * on the one path where `checkPlan` returned null *cleanly* (neither key matched), which is exactly
 * that fact. A thrown check is a different null and must not reach here — a database that could not
 * answer is not evidence that nothing references the plan. As defence in depth the function also
 * re-checks the `proposal_plan_id` key itself before writing: it is exported through the slice
 * barrel, and no future caller may be able to un-pend a mid-solve clone (only the proposal key is
 * checked — a job naming the plan as *source* is unharmed by un-pending).
 *
 * **Why the orphan exists at all.** `generation_jobs.plan_id` is `on delete cascade`, and
 * `assertNoActiveJob` deliberately lets a *stale* active job through — a container that vanished must
 * not hold a plan hostage forever. So deleting the source of a wedged solve takes the job row with it
 * and leaves the clone `pending_proposal = true` with nothing left that could ever clear the flag.
 * `proposalIsReleasable` already made that clone *deletable*; this makes it *usable*, which is the
 * other half of the same thought — the plan holds a real board (the source's pins, copied by
 * `clone_plan`), and "delete it" should not be the only thing an author can do with it.
 *
 * **The `created_at` guard is the race, not a nicety.** `startGeneration` flags the clone pending one
 * round trip BEFORE it inserts the job row, so "pending with no job" is transiently true during every
 * single Generate. An unconditional clear would race that window and un-pend a clone a solve is about
 * to be dispatched for. A genuine orphan is always old enough: its source's deletion required a job
 * already quiet past `HEARTBEAT_GRACE_MS`, and the clone predates that job. Reusing the same grace
 * keeps "old enough to be dead" defined once, in `job-staleness.ts`.
 *
 * That guard also heals a second cause for free: a process that died inside the enqueue window leaves
 * the identical shape, and after the grace this releases it too.
 *
 * **Loud on database error**, following `clearPending` rather than `failJob`: the failure mode is a
 * plan stranded read-only, not a bit of litter, so the caller must hear about it. The plan ROUTE then
 * chooses to soften it — a failed release renders today's pending panel, never a 500.
 */
export const releaseOrphanProposal = async (supabase: SupabaseClient, planId: string): Promise<void> => {
  const { data: referencingJobs, error: lookupError } = await supabase
    .from("generation_jobs")
    .select("id")
    .eq("proposal_plan_id", planId)
    .limit(1);
  if (lookupError) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to release the stranded proposal: ${lookupError.message}`);
  }
  if (referencingJobs.length > 0) return;

  const { error } = await supabase
    .from("plans")
    .update({ pending_proposal: false })
    .eq("id", planId)
    .eq("pending_proposal", true)
    .lt("created_at", stalenessCutoff(Date.now()));
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to release the stranded proposal: ${error.message}`);
  }
};
