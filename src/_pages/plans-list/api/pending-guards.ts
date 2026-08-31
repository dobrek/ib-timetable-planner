import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import {
  isActiveJobStatus,
  isDeliverableJob,
  isGenerationJobStatus,
  isStaleActiveJob,
  type GenerationJobStatus,
} from "@/entities/timetable";

/**
 * The hub's half of S-306's guard surface: no plan action may touch a proposal whose board has not
 * landed, and no plan action may delete a plan a solve is currently reading.
 *
 * The routes refuse a pending proposal by rendering a notice instead of a page, which is what the
 * author sees. These are the same refusals at the ACTION boundary, and they are not belt-and-braces:
 * the hub's Rename, Clone and Delete are reached from the plans list, which lists a pending proposal
 * on purpose — so the hub is the one place where an edit affordance and a pending plan are on screen
 * together. (The board-mutation actions are deliberately NOT guarded: they are unreachable without a
 * rendered board, and a pending plan renders none. That is a documented assumption; if a direct
 * action call on a pending plan ever matters, `placeCourse` and friends take the same predicate.)
 *
 * **Two questions, two guards, because the two failures are different.**
 *
 * `assertNotPending` protects the PROPOSAL. Editing the clone's catalog between enqueue and delivery
 * breaks the natural-key translation the delivery depends on, and the solve dies terminal with a
 * board nobody can have.
 *
 * `assertNoActiveJob` protects the SOURCE. `generation_jobs.plan_id` is `on delete cascade`
 * (20260810200122:60), so deleting the source mid-solve deletes the job row itself — which strands
 * the clone pending with nothing left that could ever un-pend it, and pulls the row out from under a
 * running solver. That one is not recoverable through the UI at all, which is why it is guarded even
 * though the source plan is otherwise perfectly ordinary.
 *
 * **Staleness releases both.** A job that has gone quiet past `HEARTBEAT_GRACE_MS` is already treated
 * as dead by the reclaim path, so it must not hold a plan hostage here either — otherwise a container
 * that vanished would leave two undeletable plans behind forever.
 */
export const assertNotPending = async (
  supabase: SupabaseClient,
  planId: string,
  options: { allowTerminal?: boolean } = {},
): Promise<void> => {
  const plan = await readPlan(supabase, planId);
  // Not found is not this guard's business — the action's own `unwrapRow` reports it in its own words.
  if (!plan?.pending_proposal) return;

  if (options.allowTerminal && (await proposalIsReleasable(supabase, planId))) return;

  throw new DomainError(
    "CONFLICT",
    options.allowTerminal
      ? `"${plan.name}" is a proposal that is still being generated, or is finished but not yet delivered. ` +
          `Open the proposal to deliver it first.`
      : `"${plan.name}" is a proposal that is still being generated. It becomes an ordinary plan once its board lands.`,
  );
};

/**
 * Refuse to delete a plan that a live solve is reading from.
 *
 * A *stale* active job does not block: reclaim already treats it as dead, and the author must be able
 * to clean up after a container that never came back.
 *
 * A DELIVERABLE-but-undelivered job blocks too, for the same cascade reason with a worse outcome: the
 * solve is finished, its `result` lives only on the job row, and deleting the source would take that
 * row with it — a 20-minute board gone silently, and a clone left pending that no job references.
 * "Open the proposal to deliver it first" is one click, and the same rule the proposal side applies.
 *
 * *Undelivered* is `isDeliverableJob`'s business, and since it consults `delivery` this guard no
 * longer refuses on a job that DID deliver into a proposal the author has since deleted — which used
 * to be a dead end, since the refusal named a plan that no longer exists.
 */
export const assertNoActiveJob = async (supabase: SupabaseClient, planId: string): Promise<void> => {
  const jobs = await jobsWhere(supabase, "plan_id", planId);
  const nowMs = Date.now();
  const live = jobs.find((job) => isActiveJobStatus(job.status) && !isStaleActiveJob(job, nowMs));
  const ready = live ? null : jobs.find(isDeliverableJob);
  const blocking = live ?? ready;
  if (!blocking) return;

  const proposalName =
    blocking.proposal_plan_id === null ? null : (await readPlan(supabase, blocking.proposal_plan_id))?.name;
  const into = proposalName ? ` into "${proposalName}"` : "";
  throw new DomainError(
    "CONFLICT",
    live
      ? `A generation is running for this plan${into}. ` +
          `Wait for it to finish — deleting the plan now would end the solve and strand the proposal.`
      : `A generated board for this plan${into} is ready but not yet delivered. ` +
          `Open the proposal to deliver it first — deleting the plan now would discard the solve.`,
  );
};

/**
 * Whether a pending proposal may be removed by hand after all.
 *
 * Allowed: a `failed` job, a halted one that kept no checkpoint (both swept anyway), a stale active
 * job — and, importantly, **no referencing job at all**. A clone whose job row is gone (the source was
 * deleted before this guard existed, or a detach left it alone) must always be deletable, or the only
 * way out is SQL.
 *
 * Refused: an active-and-fresh job, and a DELIVERABLE-but-undelivered one. The second is the subtle
 * case. `proposal_plan_id` is `on delete set null`, and `deliver()` on a null proposal marks the job
 * `failed` with "the proposal plan no longer exists" — so deleting a ready proposal would show the
 * author a red failure on the source plan's strip and an error toast on the hub, for a deletion they
 * asked for. Refusing with "open it to deliver first" costs one click and tells the truth. Once
 * delivered the plan is no longer pending, so this guard is not consulted at all — and unlike the
 * sentence this echoes (retracted in `job-delivery.ts`, it hid D2), the claim holds here: it rests
 * on the `pending_proposal` flag, which no `on delete set null` FK can quietly flip back.
 */
const proposalIsReleasable = async (supabase: SupabaseClient, proposalPlanId: string): Promise<boolean> => {
  const jobs = await jobsWhere(supabase, "proposal_plan_id", proposalPlanId);
  if (jobs.length === 0) return true;

  const nowMs = Date.now();
  return jobs.every(
    (job) => !isDeliverableJob(job) && (!isActiveJobStatus(job.status) || isStaleActiveJob(job, nowMs)),
  );
};

type GuardJobRow = {
  status: GenerationJobStatus;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  /** The durable half of "did this job deliver?" — `delivered_plan_id` is `on delete set null` and
   *  this is not, so the two disagree exactly when a delivered proposal has since been deleted. */
  delivery: string | null;
  checkpoint_stage_index: number | null;
  heartbeat_at: string | null;
  created_at: string;
};

/** One indexed read (`generation_jobs_plan_idx` / `_proposal_plan_idx`), scalars only. A row whose
 *  status this build does not recognise is dropped rather than cast — the house rule at every
 *  `generation_jobs` boundary, and here it fails OPEN, which is right: an unreadable row must not be
 *  able to make a plan permanently undeletable. */
const jobsWhere = async (
  supabase: SupabaseClient,
  column: "plan_id" | "proposal_plan_id",
  planId: string,
): Promise<GuardJobRow[]> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("status, proposal_plan_id, delivered_plan_id, delivery, checkpoint_stage_index, heartbeat_at, created_at")
    .eq(column, planId);
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Generation job lookup failed: ${error.message}`);
  return data.flatMap((row) => (isGenerationJobStatus(row.status) ? [{ ...row, status: row.status }] : []));
};

const readPlan = async (
  supabase: SupabaseClient,
  planId: string,
): Promise<{ name: string; pending_proposal: boolean } | null> => {
  const { data, error } = await supabase.from("plans").select("name, pending_proposal").eq("id", planId).maybeSingle();
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Plan lookup failed: ${error.message}`);
  return data;
};
