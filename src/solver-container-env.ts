/**
 * What the Worker forwards into the solver container, as a pure function so the rule is testable.
 *
 * **The Worker is a courier, not a new privilege holder.** A Cloudflare container cannot read Worker
 * secrets on its own — there is no `containers[].configuration.secrets` field — so the DO reads them
 * and passes them down through `envVars`. Everything here is either already held by the Worker (the
 * publishable key, the project URL) or used by nothing but the container (`SOLVER_MACHINE_PASSWORD`).
 * No secret key, no service-role key: `services/solver/src/cpsat_service/settings.py` documents why.
 *
 * Lives beside `solver-container.ts` at the top level of `src/` rather than under an FSD layer,
 * because it is deployment wiring. `steiger` does not inspect top-level files.
 */
export type SolverContainerEnv = {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_KEY?: string;
  readonly SOLVER_MACHINE_PASSWORD?: string;
  readonly SOLVER_SUPABASE_URL?: string;
};

/** Pinned, explicit, and never inherited — see the per-key notes in `solverContainerEnvVars`. */
export const CONTAINER_WORKERS = "4";
export const CONTAINER_MAX_CONCURRENT_JOBS = "1";
export const CONTAINER_LOG_LEVEL = "INFO";

export const solverContainerEnvVars = (env: SolverContainerEnv): Record<string, string> => ({
  // `SOLVER_SUPABASE_URL` wins when present, and it exists for exactly one reason: in local
  // `wrangler dev` (tier 3) the Worker's own `SUPABASE_URL` is `http://127.0.0.1:54321`, which
  // inside the container resolves to the CONTAINER's loopback and refuses every connection. The
  // container needs `host.docker.internal` while the Worker needs `127.0.0.1`, so the two cannot
  // share one value. Production never sets it — no such Worker secret exists — which is what keeps
  // this a dev affordance rather than a second source of truth for the project URL.
  SUPABASE_URL: env.SOLVER_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
  SUPABASE_KEY: env.SUPABASE_KEY ?? "",
  SOLVER_MACHINE_PASSWORD: env.SOLVER_MACHINE_PASSWORD ?? "",

  // Explicit, not inherited. The service's own default is 8 (`settings.py:31`, pinned for
  // reproducibility), and 8 CP-SAT workers timesharing `standard-4`'s 4 vCPU honours that pin
  // nominally while losing the property it protects. Whatever ships here becomes the fixture S-308's
  // calibration measures against, so a silent default is the one outcome that must not happen.
  SOLVER_WORKERS: CONTAINER_WORKERS,
  SOLVER_MAX_CONCURRENT_JOBS: CONTAINER_MAX_CONCURRENT_JOBS,
  SOLVER_LOG_LEVEL: CONTAINER_LOG_LEVEL,
});
