import { z } from "zod";
import { clonePlan, UNIQUE_VIOLATION, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import {
  computeSnapshotHash,
  isGenerationJobStatus,
  type GeneratorSnapshot,
  type SolverTransport,
} from "@/entities/timetable";
import { toPlanSnapshot } from "../model/generation/plan-snapshot";
import { reclaimStaleJob } from "./generation-reclaim";
import { loadCombinedPlannerData } from "./load";

/**
 * Enqueue a CP-SAT generation job for a plan (S-301's launch half).
 *
 * **Ordering is the contract, not a preference.** Assemble + hash first — pure reads, no side effects
 * — then clone, then insert the row, then dispatch. Every ERROR path therefore unwinds cleanly: a
 * refused dispatch marks the row `failed` and sweeps the clone. What ordering cannot rule out is
 * process death between the insert and the dispatch — a stranded `queued` row nothing was dispatched
 * for, which no later reader can distinguish from a solver that died before claiming, and which wedges
 * this plan's Generate via the partial unique index.
 *
 * **S-304 closed that window, on the conflict path only.** The `23505` this function already maps to
 * `CONFLICT` is exactly where a wedge is felt, so that is where it is answered: read the one row
 * blocking the index, and if it has gone quiet past the grace, reclaim it to `interrupted` and retry
 * the insert once. The happy path gains ZERO reads — recovery costs nothing until something is
 * actually broken. The authoritative reclaim is still the plan visit (`checkPlan`), which also
 * delivers the dead solve's checkpoint; this is the backstop for the author who clicks Generate from
 * the hub without ever loading the plan page.
 *
 * **The snapshot is assembled from the SOURCE plan**, not the clone, and hashed as such. `clone_plan`
 * re-mints every course UUID (measured: 0 of 84 survive), so a clone-assembled snapshot could never
 * hash equal to a source-assembled one. The clone is the APPLY TARGET, reached at delivery through the
 * natural-key `courseId` translation (`buildCourseIdMap`). Note `snapshot_hash` is no longer a DRIFT
 * column — S-306 retired the drift gate along with merge, and the source is never written to — so its
 * one live reader is the solver's snapshot BINDING check (`cpsat_service/runner.py`).
 *
 * **The clone is born PENDING** (S-306). `plans.pending_proposal` is set immediately after
 * `clone_plan` returns, and every by-id surface and plan action refuses a pending plan — that is what
 * stops the author editing the apply target out from under a 20-minute solve. The flag is a separate
 * `update` rather than a `clone_plan` argument on purpose: the hub's Clone dialog shares that RPC and
 * must keep producing ordinary plans. A clone that cannot be flagged is DELETED rather than left
 * unflagged; an unflagged clone is exactly the hazard the flag exists to remove.
 *
 * **The transport is injected, never imported.** `getSolverTransport` reads `astro:env/server`, which
 * a `_pages` module may not reach: it is composed in `src/actions/` (outside the FSD graph) and passed
 * in. That keeps this function unit-testable — the same reason `solver-transport.ts` was split from
 * `solver-config.ts` — and keeps a server-only virtual module out of the slice's import graph.
 */
export type GenerationDeps = {
  /** Null when `SOLVER_URL` is unset — dispatch is simply unavailable, not broken. */
  getTransport: () => SolverTransport | null;
};

export const startGenerationInput = z.object({ planId: z.uuid() });

export type StartGenerationInput = z.infer<typeof startGenerationInput>;

export type StartGenerationResult = {
  jobId: string;
  proposalPlanId: string;
  /** Zero-student courses whose uncovered hours were parked before solving — the audit list. */
  autoParked: { cohort: string; courseId: string; hoursParked: number }[];
};

export const startGeneration = async (
  supabase: SupabaseClient,
  input: StartGenerationInput,
  deps: GenerationDeps,
): Promise<StartGenerationResult> => {
  // Cheapest failure first, and the only one that must happen before any write: with no transport
  // there is nothing to dispatch to, so a clone and a row would both be litter.
  const transport = deps.getTransport();
  if (!transport) {
    throw new DomainError(
      "UNPROCESSABLE_CONTENT",
      "Generation dispatch is unavailable — the solver service is not configured for this environment.",
    );
  }

  const { snapshot, snapshotHash, planName, autoParked } = await assembleSource(supabase, input.planId);
  const proposalPlanId = await createProposalPlan(supabase, input.planId, planName);

  const jobId = await insertJob(supabase, {
    planId: input.planId,
    proposalPlanId,
    snapshot,
    snapshotHash,
  }).catch(async (error: unknown) => {
    await deleteOrphanClone(supabase, proposalPlanId);
    throw error;
  });

  await dispatch(transport, jobId, snapshot).catch(async (error: unknown) => {
    // The row exists and is `queued`, so it must reach a terminal state here — nothing else will
    // ever look at it. Marking `failed` before deleting the clone keeps the two consistent even if
    // the delete fails.
    await markDispatchFailed(supabase, jobId, error);
    await deleteOrphanClone(supabase, proposalPlanId);
    throw error instanceof DomainError
      ? error
      : new DomainError("INTERNAL_SERVER_ERROR", `Could not reach the solver service: ${messageOf(error)}`);
  });

  return { jobId, proposalPlanId, autoParked };
};

type AssembledSource = {
  snapshot: GeneratorSnapshot;
  snapshotHash: string;
  planName: string;
  autoParked: StartGenerationResult["autoParked"];
};

/** The plan's own loader, then the pure projection — so the dispatched snapshot is exactly the one
 *  the board would have assembled from the same load. */
const assembleSource = async (supabase: SupabaseClient, planId: string): Promise<AssembledSource> => {
  const loaded = await loadCombinedPlannerData(supabase, planId);
  if (!loaded.ok) {
    throw loaded.error.kind === "not-found"
      ? new DomainError("NOT_FOUND", `Plan ${planId} was not found.`)
      : new DomainError("INTERNAL_SERVER_ERROR", loaded.error.message);
  }
  const { shared, dp1, dp2, planName } = loaded.value;
  const { snapshot, autoParked } = toPlanSnapshot(shared, { dp1, dp2 });
  return { snapshot, snapshotHash: await computeSnapshotHash(snapshot), planName, autoParked };
};

/** `plans.name` carries no unique constraint, so a generated proposal name is always safe. The clone
 *  keeps its board — the author's pins are the solve's fixed points and must survive onto the target.
 *  It is flagged pending before it is returned, and swept if that flag cannot be written. */
const createProposalPlan = async (
  supabase: SupabaseClient,
  sourcePlanId: string,
  planName: string,
): Promise<string> => {
  const { id } = await clonePlan(supabase, {
    sourcePlanId,
    name: `Proposal — ${planName}`,
    includeBoard: true,
  });
  await markPending(supabase, id);
  return id;
};

/** The one window this closes is between `clone_plan` returning and the guard being true, so it is
 *  the very next statement — and its failure sweeps rather than proceeds. */
const markPending = async (supabase: SupabaseClient, proposalPlanId: string): Promise<void> => {
  const { error } = await supabase.from("plans").update({ pending_proposal: true }).eq("id", proposalPlanId);
  if (!error) return;
  await deleteOrphanClone(supabase, proposalPlanId);
  throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to mark the proposal plan pending: ${error.message}`);
};

const insertJob = async (
  supabase: SupabaseClient,
  row: { planId: string; proposalPlanId: string; snapshot: GeneratorSnapshot; snapshotHash: string },
  { recover = true }: { recover?: boolean } = {},
): Promise<string> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      plan_id: row.planId,
      proposal_plan_id: row.proposalPlanId,
      snapshot: row.snapshot,
      snapshot_hash: row.snapshotHash,
      // A minimal audit descriptor, deliberately not a policy vocabulary: clean mode is the solver's
      // shipped default and the service never reads this column (F-302). S-307 owns what goes here.
      policy: { clean: true },
    })
    .select("id")
    .single();

  // The partial unique index `generation_jobs_active_per_plan` is what makes "one active job per
  // plan" true even when two Workers race the same click — so this is the expected path, not an edge.
  if (error?.code === UNIQUE_VIOLATION) {
    // Once, and only once. If the retry conflicts again, a genuinely live job won the race and
    // `CONFLICT` is the truthful answer — retrying further would just spin against a healthy solve.
    if (recover && (await reclaimBlockingJob(supabase, row.planId))) {
      return insertJob(supabase, row, { recover: false });
    }
    throw new DomainError("CONFLICT", "A generation is already running for this plan.");
  }
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to enqueue the generation job: ${error.message}`);
  return data.id;
};

/**
 * The one row the partial unique index is blocking on, reclaimed if it has gone quiet. True iff the
 * insert is now worth retrying.
 *
 * The clone handling splits on the same question `checkPlan` asks. **No checkpoint** means the
 * dead job kept nothing, so its clone is litter and goes the way a failed job's does. **With a
 * checkpoint** both the row and the clone are left exactly as they are: that board is salvage, the
 * normal path (a plan visit) delivers it, and the author is explicitly starting fresh alongside it
 * rather than instead of it.
 */
const reclaimBlockingJob = async (supabase: SupabaseClient, planId: string): Promise<boolean> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("id, status, heartbeat_at, created_at, proposal_plan_id, delivered_plan_id, checkpoint_stage_index")
    .eq("plan_id", planId)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (error || data === null) return false;
  if (!isGenerationJobStatus(data.status)) return false;

  const reclaimed = await reclaimStaleJob(supabase, { ...data, status: data.status });
  if (reclaimed === null) return false;

  if (data.checkpoint_stage_index === null && data.delivered_plan_id === null && data.proposal_plan_id !== null) {
    await deleteOrphanClone(supabase, data.proposal_plan_id);
  }
  return true;
};

const dispatch = async (transport: SolverTransport, jobId: string, snapshot: GeneratorSnapshot): Promise<void> => {
  await transport.dispatchSolveJob(jobId, { formatVersion: 1, snapshot });
};

/** Best-effort: the caller is already throwing the real failure, and a row left `queued` is worse
 *  than a row marked `failed` with a slightly lossy message. */
const markDispatchFailed = async (supabase: SupabaseClient, jobId: string, cause: unknown): Promise<void> => {
  const { error } = await supabase
    .from("generation_jobs")
    .update({ status: "failed", error: `dispatch failed: ${messageOf(cause)}`, finished_at: new Date().toISOString() })
    .eq("id", jobId);
  // eslint-disable-next-line no-console
  if (error) console.error(`[startGeneration] could not mark job ${jobId} failed:`, error.message);
};

/**
 * Delete a proposal clone that never became a proposal. Narrow by construction — it is only ever
 * called with an id this function just created, before anything could have been delivered onto it.
 */
const deleteOrphanClone = async (supabase: SupabaseClient, proposalPlanId: string): Promise<void> => {
  const { error } = await supabase.from("plans").delete().eq("id", proposalPlanId);
  // eslint-disable-next-line no-console
  if (error) console.error(`[startGeneration] could not delete orphan clone ${proposalPlanId}:`, error.message);
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
