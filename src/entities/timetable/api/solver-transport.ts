import { canonicalizeSolveRequest, type SolveRequest } from "../model/generation/wire";

/**
 * The app's side of the CP-SAT solver transport — dispatch and a health probe, nothing more.
 *
 * A **pure factory over `fetch`**, and that shape is load-bearing twice over:
 *
 *  1. It must not import `astro:env/server`. A module that reads the env at import time is
 *     unimportable from plain vitest, which would put the proof-of-life integration test out of
 *     reach of the exact function S-301 will call. The env read lives in `solver-config.ts`.
 *  2. It is the S-302 seam. Production reaches the container through a Durable Object container
 *     binding rather than a URL, so what changes then is the FACTORY INPUT — not the call sites.
 *
 * Deliberately NOT a `GeneratePlan`. That port is `(snapshot, config) => Promise<GenerationResult>`
 * — one awaited call returning a board. A CP-SAT job answers 202 and delivers minutes later through
 * a database row, so forcing it into the port would mean either a request held open for twenty
 * minutes or a fake promise wrapping a poll. The oracle (`runVerifiedGeneration`) still applies —
 * on the result-READ side, which is S-301's.
 */
export type SolverTransport = {
  /** POST the request and resolve once the service has ACCEPTED it (202). The solve outcome
   *  arrives later, through `generation_jobs`. */
  dispatchSolveJob: (jobId: string, request: SolveRequest) => Promise<void>;
  /** True when the service answers `/health`. Never throws — an unreachable solver is a state to
   *  render, not an exception to handle at every call site. */
  checkHealth: () => Promise<boolean>;
};

/** A dispatch that the service refused, carrying enough to show the author what went wrong. */
export class SolverDispatchError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`the solver service rejected the job (HTTP ${status}): ${body}`);
    this.name = "SolverDispatchError";
  }
}

export const createSolverTransport = (baseUrl: string): SolverTransport => {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async dispatchSolveJob(jobId, request) {
      // Through the canonicalizer, so dispatch is deterministic for free: two callers that
      // assembled the same solve in a different order send byte-identical bodies.
      const response = await fetch(`${root}/jobs/${jobId}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonicalizeSolveRequest(request),
      });
      // 202 is the ONLY success. A 2xx that is not 202 would mean the service answered something
      // this client does not understand, and treating it as accepted would lose the job silently.
      if (response.status !== 202) throw new SolverDispatchError(response.status, await response.text());
    },

    async checkHealth() {
      try {
        const response = await fetch(`${root}/health`);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
};
