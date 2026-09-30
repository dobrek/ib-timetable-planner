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
 *
 * **Production may diverge from `main` while a calibration override is set** (2026-09, S-308's
 * campaign automation). The three `CALIBRATION_*` Worker secrets below replace the pinned tuning
 * constants without a merge, so a campaign cell is a `wrangler secret bulk` rather than a deploy that
 * rolls the container. The constants stay the visible production default; an override is visible in
 * `SolverContainer.status()` (`effectiveTuning.overridden`) and in every job row's `solver_config`,
 * and the campaign runner removes the secrets when it parks or cleans up.
 */
export type SolverContainerEnv = {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_KEY?: string;
  readonly SOLVER_MACHINE_PASSWORD?: string;
  readonly SOLVER_SUPABASE_URL?: string;
  readonly CALIBRATION_WORKERS?: string;
  readonly CALIBRATION_STAGE_BUDGET_S?: string;
  readonly CALIBRATION_MODE_A_BUDGET_S?: string;
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

/** The Worker secrets a calibration campaign may set. `CONTAINER_STAGE_TARGETS` has none on purpose:
 *  a target is a catalog property, and a campaign measures budgets, not bounds. */
export const CALIBRATION_KEYS = [
  "CALIBRATION_WORKERS",
  "CALIBRATION_STAGE_BUDGET_S",
  "CALIBRATION_MODE_A_BUDGET_S",
] as const;

export type CalibrationKey = (typeof CALIBRATION_KEYS)[number];

type Bounds = { readonly min: number; readonly max: number; readonly integer: boolean };

/**
 * What an override may say. Outside these it is ignored and the constant wins — a typo in a secret
 * must degrade to the production default, never to a container told to solve with 0 workers or a
 * day-long stage. The campaign runner validates Cell D against the same table before it sets a secret.
 *
 * Workers stop at 16: the container is `standard-4`, and past that CP-SAT is timesharing a handful of
 * vCPU. A stage stops at 30 minutes, past the whole ladder's UI ceiling; Mode A at an hour.
 */
export const CALIBRATION_BOUNDS: Readonly<Record<CalibrationKey, Bounds>> = {
  CALIBRATION_WORKERS: { min: 1, max: 16, integer: true },
  CALIBRATION_STAGE_BUDGET_S: { min: 1, max: 1_800, integer: false },
  CALIBRATION_MODE_A_BUDGET_S: { min: 1, max: 3_600, integer: false },
};

/** The four tuning values the next cold start would receive, and which of them an override set. */
export type EffectiveTuning = {
  readonly workers: number;
  readonly stageBudgetS: number;
  readonly modeABudgetS: number;
  readonly stageTargets: string;
  readonly overridden: readonly CalibrationKey[];
};

/**
 * The tuning a container would boot with under this environment: each pinned constant, unless its
 * `CALIBRATION_*` override is a well-formed positive decimal inside {@link CALIBRATION_BOUNDS}.
 *
 * An empty string is unset, not malformed — `wrangler secret bulk` cannot store "no value", and a
 * parked override may linger as `""`. A malformed or out-of-range value falls back silently here and
 * shows up as "not overridden" in `status()`, which is how the runner notices its secret was refused.
 *
 * **Intent, not fact.** This is what the NEXT cold start receives; a warm container keeps the values it
 * booted with. Only the job row's `solver_config` says what actually solved.
 */
export const effectiveTuning = (env: SolverContainerEnv): EffectiveTuning => {
  const workers = readOverride(env, "CALIBRATION_WORKERS");
  const stageBudgetS = readOverride(env, "CALIBRATION_STAGE_BUDGET_S");
  const modeABudgetS = readOverride(env, "CALIBRATION_MODE_A_BUDGET_S");
  return {
    workers: workers ?? Number(CONTAINER_WORKERS),
    stageBudgetS: stageBudgetS ?? Number(CONTAINER_STAGE_BUDGET_S),
    modeABudgetS: modeABudgetS ?? Number(CONTAINER_MODE_A_BUDGET_S),
    stageTargets: CONTAINER_STAGE_TARGETS,
    overridden: CALIBRATION_KEYS.filter((key) => readOverride(env, key) !== null),
  };
};

/** Whether `value` is one an override may carry — the same rule `effectiveTuning` applies, exposed so
 *  the campaign runner can refuse a Cell D the Worker would silently ignore. */
export const isValidCalibrationValue = (key: CalibrationKey, value: number): boolean => {
  const { min, max, integer } = CALIBRATION_BOUNDS[key];
  return Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
};

export const solverContainerEnvVars = (env: SolverContainerEnv): Record<string, string> => {
  const tuning = effectiveTuning(env);
  return {
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
    SOLVER_WORKERS: String(tuning.workers),
    SOLVER_MAX_CONCURRENT_JOBS: CONTAINER_MAX_CONCURRENT_JOBS,
    SOLVER_LOG_LEVEL: CONTAINER_LOG_LEVEL,

    // Explicit for the same reason `SOLVER_WORKERS` is: the service treats an absent budget as "keep
    // the engine's own literal", which is a perfectly good default and a terrible RECORD. A campaign
    // needs to distinguish a container that was told 120 from one that fell through to 120, and the
    // startup log line can only say so if the Worker actually sent it. A calibration cell changes
    // these through a `CALIBRATION_*` secret (see `effectiveTuning`), in effect at the container's
    // next cold start; the constants above stay the production default.
    SOLVER_STAGE_BUDGET_S: String(tuning.stageBudgetS),
    SOLVER_MODE_A_BUDGET_S: String(tuning.modeABudgetS),
    SOLVER_STAGE_TARGETS: tuning.stageTargets,
  };
};

const DECIMAL = /^\d+(\.\d+)?$/;

/** The override's value when it is well-formed and in bounds; `null` for unset, empty or refused. */
const readOverride = (env: SolverContainerEnv, key: CalibrationKey): number | null => {
  const raw = env[key]?.trim();
  if (!raw || !DECIMAL.test(raw)) return null;
  const value = Number(raw);
  return isValidCalibrationValue(key, value) ? value : null;
};
