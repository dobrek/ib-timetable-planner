import { useState } from "react";
import type { GenerationJobView } from "../../api/generation-delivery";
import {
  checkGeneration as checkGenerationAction,
  startGeneration as startGenerationAction,
} from "../../api/generation-client";

/**
 * The CP-SAT generation job's client-side lifecycle — the hook behind the Generate button (S-301).
 *
 * The shape of the problem changed with the engine, not just the engine. The greedy predecessor was
 * a ~20 s in-page solve a hook could watch tick by tick; a CP-SAT run is ~12 minutes on a server and
 * the page will usually be gone before it finishes. So this hook does not own a solve — it owns an
 * ENQUEUE and a RE-READ, with a durable row (`generation_jobs`) in between. That is why there is no
 * elapsed/budget progress and no "Stop & keep": a job that outlives the page cannot be cancelled from
 * a closed tab (S-305 gives it a real server-side stop path).
 *
 * **The on-visit check is NOT here — it already happened.** `src/pages/plans/[id]/index.astro` runs
 * `checkGeneration` in the page render and seeds `initialJob`, which means the visit itself is the
 * trigger: no client round-trip, no frame of empty strip, and no fetch-and-set-state effect (which
 * React 19's rules reject and the React Compiler refuses to optimize around). This hook only handles
 * what the author does AFTER the page exists — launching, and asking again.
 *
 * `refresh` is not a passive read either: on a job that has succeeded, that call is what verifies the
 * board server-side and applies it to the proposal plan.
 *
 * **Nothing here loops, and S-303 deliberately did not change that.** The live stage-by-stage view is
 * on the plans list, where there is no board for a poll to contend with; this island keeps the static
 * FR-308 advisory and a link to it. Anything that wants to loop belongs there, not here.
 */
export type GenerationJob = { jobId: string; proposalPlanId: string };

export type GenerationJobState =
  | { status: "idle" }
  | { status: "launching" }
  /** Seeded from the server, or read back after a launch or a refresh. */
  | { status: "tracking"; job: GenerationJobView };

export type UseGenerationJobDeps = {
  planId: string;
  /** The server-side on-visit check's result — the strip's initial state. */
  initialJob: GenerationJobView | null;
  /** True while other board writes are unsettled — Generate participates in the same gating. */
  busy: boolean;
  /** Injectable for tests; default to the Astro Action clients. */
  start?: (planId: string) => Promise<GenerationJob>;
  check?: (planId: string) => Promise<GenerationJobView | null>;
};

export type GenerationJobControls = {
  state: GenerationJobState;
  error: string | null;
  /** True while a check/delivery round-trip is in flight — the strip's Refresh shows it. */
  checking: boolean;
  launch: () => void;
  refresh: () => void;
};

export function useGenerationJob({
  planId,
  initialJob,
  busy,
  start = startGenerationAction,
  check = checkGenerationAction,
}: UseGenerationJobDeps): GenerationJobControls {
  const [state, setState] = useState<GenerationJobState>(
    initialJob ? { status: "tracking", job: initialJob } : { status: "idle" },
  );
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function runCheck(): Promise<void> {
    setChecking(true);
    try {
      const job = await check(planId);
      setState(job ? { status: "tracking", job } : { status: "idle" });
    } catch (cause: unknown) {
      setError(messageOf(cause, "Could not read the generation job"));
      // A failed read must never strand "launching": the button would stay disabled and the strip
      // (which renders only when tracking) would hide its Refresh — the one recovery affordance.
      // Fall back to idle; the job row is durable, so the next visit or refresh finds it honestly.
      setState((prev) => (prev.status === "launching" ? { status: "idle" } : prev));
    } finally {
      setChecking(false);
    }
  }

  function launch() {
    // The same guard the greedy hook used: an unsettled board would be hashed mid-write, and the
    // snapshot the solver is judged against has to be a state that actually exists.
    if (busy || state.status === "launching") return;
    setError(null);
    setState({ status: "launching" });
    void start(planId).then(
      // Read the row straight back rather than synthesising a view from the launch result: one shape
      // for the strip, and `createdAt` comes from the database rather than the browser clock.
      () => runCheck(),
      (cause: unknown) => {
        setError(messageOf(cause, "Could not start generation"));
        setState({ status: "idle" });
      },
    );
  }

  function refresh() {
    setError(null);
    void runCheck();
  }

  return { state, error, checking, launch, refresh };
}

const messageOf = (cause: unknown, fallback: string): string => (cause instanceof Error ? cause.message : fallback);
