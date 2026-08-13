import { z } from "zod";
import { clonePlan, UNIQUE_VIOLATION, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { computeSnapshotHash, type GeneratorSnapshot, type SolverTransport } from "@/entities/timetable";
import { toPlanSnapshot } from "../model/generation/plan-snapshot";
import { loadCombinedPlannerData } from "./load";

/**
 * Enqueue a CP-SAT generation job for a plan (S-301's launch half).
 *
 * **Ordering is the contract, not a preference.** Assemble + hash first — pure reads, no side effects
 * — then clone, then insert the row, then dispatch. Every ERROR path therefore unwinds cleanly: a
 * refused dispatch marks the row `failed` and sweeps the clone. What ordering cannot rule out is
 * process death between the insert and the dispatch — a stranded `queued` row nothing was dispatched
 * for, which no later reader can distinguish from a solver that died before claiming, and which wedges
 * this plan's Generate via the partial unique index. That recovery window belongs to S-304's staleness
 * reclaim (recorded in change.md), not to this slice.
 *
 * **The snapshot is assembled from the SOURCE plan**, not the clone, and hashed as such. `clone_plan`
 * re-mints every course UUID (measured: 0 of 84 survive), so a clone-assembled snapshot could never
 * hash equal to a source-assembled one — FR-307's drift check would report drift on every run and
 * S-306's auto-apply could never fire. The clone is the APPLY TARGET, reached at delivery through the
 * natural-key `courseId` translation (`buildCourseIdMap`).
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
 *  keeps its board — the author's pins are the solve's fixed points and must survive onto the target. */
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
  return id;
};

const insertJob = async (
  supabase: SupabaseClient,
  row: { planId: string; proposalPlanId: string; snapshot: GeneratorSnapshot; snapshotHash: string },
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
    throw new DomainError("CONFLICT", "A generation is already running for this plan.");
  }
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to enqueue the generation job: ${error.message}`);
  return data.id;
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
