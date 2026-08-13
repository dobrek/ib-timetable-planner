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
 * Read this plan's latest job back — and, when it succeeded and has not been delivered, DELIVER it:
 * the verify → translate → apply pass runs inside this call, server-side. Null when the plan has
 * never been generated. Safe to call concurrently; the delivered marker is a compare-and-set.
 */
export function checkGeneration(planId: string): Promise<GenerationJobView | null> {
  return callActionData(actions.checkGeneration, { planId });
}
