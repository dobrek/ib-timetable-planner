import { canonicalizeSolveRequest, type SolveRequest } from "../model/generation/wire";

/**
 * The app's side of the CP-SAT solver transport — dispatch and a health probe, nothing more.
 *
 * A **pure factory over `fetch`**, and that shape is load-bearing twice over:
 *
 *  1. It must not import `astro:env/server`. A module that reads the env at import time is
 *     unimportable from plain vitest, which would put the proof-of-life integration test out of
 *     reach of the exact function S-301 will call. The env read lives in `solver-config.ts`.
 *  2. It was the S-302 seam, and the seam held. Production now reaches the container through a
 *     Durable Object binding (`solver-binding-transport.ts`), and what changed was the FACTORY
 *     INPUT: a second implementation of this same type, chosen in `solver-config.ts`. No call site
 *     moved, no signature changed. This URL implementation is not legacy — it is the tier-1 local
 *     loop, the CI integration lane, and the hosted-solve campaign, and an explicit `SOLVER_URL`
 *     deliberately WINS over the binding.
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

/**
 * Both calls are bounded, because "unreachable" and "wedged" are different failures and only the
 * first one settles on its own. A service that accepts the connection and never answers would
 * otherwise leave these hanging until the Worker's own invocation limit kills the request, turning
 * `checkHealth`'s "never throws" into a 500.
 *
 * (These bounds were originally justified by containers#162, the mid-solve sleep bug — closed
 * 2026-05-12 and fixed in `@cloudflare/containers` v0.2.2. The bounds survive that fix on their own
 * merits: the platform still guarantees no minimum instance runtime, and a wedged service is a
 * failure mode no dependency version removes.)
 *
 * Dispatch gets the longer budget: it only has to survive the service ACCEPTING the job (202), and
 * the solve itself is reported minutes later through the row.
 *
 * Exported because `solver-binding-transport.ts` enforces the SAME two budgets over the container
 * binding. It cannot reuse the mechanism — an `AbortSignal` is not structured-cloneable and so
 * cannot cross Workers RPC — but the numbers must not fork, or the two transports would quietly
 * mean different things by "unreachable".
 */
export const HEALTH_TIMEOUT_MS = 3_000;
export const DISPATCH_TIMEOUT_MS = 15_000;

export const createSolverTransport = (baseUrl: string): SolverTransport => {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async dispatchSolveJob(jobId, request) {
      // Through the canonicalizer, so dispatch is deterministic for free: two callers that
      // assembled the same solve in a different order send byte-identical bodies.
      const response = await fetch(`${root}/jobs/${encodeURIComponent(jobId)}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: canonicalizeSolveRequest(request),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
      // 202 is the ONLY success. A 2xx that is not 202 would mean the service answered something
      // this client does not understand, and treating it as accepted would lose the job silently.
      if (response.status !== 202) throw new SolverDispatchError(response.status, await response.text());
    },

    async checkHealth() {
      try {
        const response = await fetch(`${root}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
};
