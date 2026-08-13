import { useState } from "react";
import { startGeneration as startGenerationAction } from "../../api/generation-client";

/**
 * The CP-SAT generation job's client-side lifecycle — the hook that replaced the greedy worker's
 * `useGeneratePlan` behind the Generate button.
 *
 * The shape of the problem changed, not just the engine. A greedy run was a ~20 s in-page solve the
 * hook could watch tick by tick; a CP-SAT run is ~12 minutes on a server and the page will usually be
 * gone before it finishes. So this hook does not own a solve — it owns an ENQUEUE, and everything
 * after that is a durable row (`generation_jobs`) the status strip reads back. That is why there is no
 * elapsed/budget progress and no "Stop & keep" here: a job that outlives the page cannot be cancelled
 * from a closed tab (S-305 gives it a real server-side stop path).
 *
 * `launch` is deliberately fire-and-observe: the action resolves as soon as the service answers 202,
 * which is the last moment the browser learns anything synchronously.
 */
export type GenerationJob = { jobId: string; proposalPlanId: string };

export type GenerationJobState =
  | { status: "idle" }
  | { status: "launching" }
  /** Dispatched and accepted. What the row does next is the strip's story, not this hook's. */
  | { status: "launched"; job: GenerationJob };

export type UseGenerationJobDeps = {
  planId: string;
  /** True while other board writes are unsettled — Generate participates in the same gating. */
  busy: boolean;
  /** Injectable for tests; defaults to the Astro Action client. */
  start?: (planId: string) => Promise<GenerationJob>;
};

export type GenerationJobControls = {
  state: GenerationJobState;
  error: string | null;
  launch: () => void;
};

export function useGenerationJob({
  planId,
  busy,
  start = startGenerationAction,
}: UseGenerationJobDeps): GenerationJobControls {
  const [state, setState] = useState<GenerationJobState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  function launch() {
    // The same guard the greedy hook used: an unsettled board would be hashed mid-write, and the
    // snapshot the solver is judged against has to be a state that actually exists.
    if (busy || state.status !== "idle") return;
    setError(null);
    setState({ status: "launching" });
    void start(planId).then(
      (job) => {
        setState({ status: "launched", job });
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not start generation");
        setState({ status: "idle" });
      },
    );
  }

  return { state, error, launch };
}
