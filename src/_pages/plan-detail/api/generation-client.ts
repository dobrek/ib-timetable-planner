import { actions } from "astro:actions";
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
