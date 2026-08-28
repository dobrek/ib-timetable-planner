import { actions } from "astro:actions";
import type { GenerationJobView } from "./generation-delivery";
import { callActionData } from "./call-action";

/** Enqueue a CP-SAT generation job for this plan. Resolves once the solver has ACCEPTED the dispatch
 *  (202); the solve itself lands minutes later on `generation_jobs`, and the strip reports it. */
export function startGeneration(planId: string): Promise<{
  jobId: string;
  proposalPlanId: string;
  autoParked: { cohort: string; courseId: string; hoursParked: number }[];
}> {
  return callActionData(actions.startGeneration, { planId });
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
