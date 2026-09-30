import { z } from "zod";
import { SOLVE_POLICY_PRESETS } from "./policy";

/**
 * The configuration a solve actually ran under, as the solver records it in
 * `generation_jobs.solver_config` (S-308's campaign automation).
 *
 * Unlike `stages`, this is **not** a projection of the frozen wire contract: the column sits outside
 * `contracts/`, and the solver's `run_record` (`services/solver/src/cpsat_service/runner.py`) is its
 * only writer. The shape is versioned inside the value, so a reader can refuse one it does not know
 * rather than misread it.
 *
 * The numbers are the EFFECTIVE ones, read off the engine's built config — an unset budget reads as
 * the engine's own literal — and `budgetSource` says, per budget, whether the deployment configured it
 * or fell through. That flag is what separates a measured campaign cell from a guess.
 */
export const storedSolverConfigSchema = z.object({
  version: z.literal(1),
  /** CP-SAT search workers. The service pins it and never sends 0 ("auto"), but a reader records
   *  what was written rather than judging it. */
  workers: z.int().min(0),
  stageBudgetS: z.number().positive(),
  modeABudgetS: z.number().positive(),
  seed: z.int(),
  budgetSource: z.object({
    stage: z.enum(["configured", "engine-default"]),
    modeA: z.enum(["configured", "engine-default"]),
  }),
  /** Tier number (as a JSON object key) to the objective value that stage stops at. Empty when none. */
  targets: z.record(z.string().regex(/^\d+$/), z.int()),
  preset: z.enum(SOLVE_POLICY_PRESETS),
  cleanMode: z.boolean(),
  /** Enough to tell the deployed container from a laptop solving against the same database. */
  host: z.object({
    machine: z.string(),
    cpuCount: z.int().min(1).nullable(),
    ortools: z.string(),
  }),
  /** Whether Mode A dropped the clean floor and re-solved. Present only once the solve has ended, and
   *  only under a clean-mode policy. */
  cleanFallback: z.boolean().optional(),
});

export type StoredSolverConfig = z.infer<typeof storedSolverConfigSchema>;

/**
 * Read a stored `solver_config` column tolerantly: `null` for a legacy row (written before the column
 * existed), an unknown `version`, or a malformed object — never a throw.
 *
 * `null` is the honest answer in every one of those cases: a row that does not say what solved it is
 * a row whose attribution is unknown, and a campaign reader must treat it as such rather than guess.
 */
export const parseStoredSolverConfig = (value: unknown): StoredSolverConfig | null => {
  const parsed = storedSolverConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
