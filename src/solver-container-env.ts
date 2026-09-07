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

/**
 * The ladder's tuning values (S-308), and the one property that makes them awkward: **a change here
 * reaches the container only at its next COLD START.** `envVars` is read when the Durable Object
 * starts the instance, so a Worker-only deploy leaves a warm container running the values it booted
 * with. Change one of these while a container is awake and the next solve is still the old cell.
 *
 * They are safe to forward for the same reason the three above are: tuning numbers, no privilege,
 * nothing a container that only ever sees UUIDs could widen its reach with.
 */
export const CONTAINER_STAGE_BUDGET_S = "120";
export const CONTAINER_MODE_A_BUDGET_S = "300";

/**
 * Empty, and deliberately so. A target is an objective VALUE and therefore a property of the
 * catalog, not of the hardware — `teacherHoles ≤ 148` is 2× one expert's result on one year's
 * intake. Shipping a value measured against a different catalog would either never fire (harmless,
 * useless) or stop a stage early on a year it was never sized for. Forwarding the key with no value
 * is what makes a season's tuning a one-line diff when there is a season to tune against.
 */
export const CONTAINER_STAGE_TARGETS = "";

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

  // Explicit for the same reason `SOLVER_WORKERS` is: the service treats an absent budget as "keep
  // the engine's own literal", which is a perfectly good default and a terrible RECORD. A campaign
  // needs to distinguish a container that was told 120 from one that fell through to 120, and the
  // startup log line can only say so if the Worker actually sent it. These three are what a
  // calibration cell edits — one line, Worker-only, in effect at the container's next cold start.
  SOLVER_STAGE_BUDGET_S: CONTAINER_STAGE_BUDGET_S,
  SOLVER_MODE_A_BUDGET_S: CONTAINER_MODE_A_BUDGET_S,
  SOLVER_STAGE_TARGETS: CONTAINER_STAGE_TARGETS,
});
