import { actions } from "astro:actions";
import type { SolvePolicy } from "@/entities/timetable";
import type { GenerationJobView } from "./generation-delivery";
import type { StopGenerationResult } from "./generation-stop";
import { callActionData } from "./call-action";

/** Enqueue a CP-SAT generation job for this plan under the author's chosen policy (S-307). Resolves
 *  once the solver has ACCEPTED the dispatch (202); the solve itself lands minutes later on
 *  `generation_jobs`, and the strip reports it. */
export function startGeneration(
  planId: string,
  policy: SolvePolicy,
): Promise<{
  jobId: string;
  proposalPlanId: string;
  autoParked: { cohort: string; courseId: string; hoursParked: number }[];
}> {
  return callActionData(actions.startGeneration, { planId, policy });
}

/**
 * Read this plan's job back — and, when it has a deliverable board, DELIVER it: the verify →
 * translate → apply pass runs inside this call, server-side.
 *
 * Dual-keyed (S-306): `planId` may be the job's SOURCE plan or its PROPOSAL plan, and the returned
 * view is tagged with which. Null when the plan is neither. Safe to call concurrently — the delivered
 * marker is a compare-and-set, so two tabs racing the same board deliver it once.
 */
export function checkPlan(planId: string): Promise<GenerationJobView | null> {
  return callActionData(actions.checkPlan, { planId });
}

/**
 * Ask a running generation to stop and keep whatever the ladder has already checkpointed (S-305).
 *
 * **It resolves when the REQUEST is durable, not when the job has stopped.** A queued job is
 * terminalised on the spot (`stopped`), but a running one is only asked: the solver notices the flag
 * on its next heartbeat — within ~15 s — and then has to unwind the ladder stage that is in flight,
 * which is budgeted in minutes. So the honest window between this promise resolving and a terminal
 * row is "a few minutes", and the caller must not present it as immediate.
 *
 * `already-finished` is a race the author wins, not an error: the solve landed first, so they get
 * the whole board. The polled snapshot is what narrates all three outcomes; this call only has to
 * surface a genuine failure.
 */
export function stopGeneration(jobId: string): Promise<StopGenerationResult> {
  return callActionData(actions.stopGeneration, { jobId });
}
