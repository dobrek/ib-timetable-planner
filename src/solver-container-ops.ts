import type { EffectiveTuning } from "./solver-container-env";

/**
 * The operator's two questions about the solver container — "what state is it in?" and "may I stop
 * it?" — as pure shapes and one pure decision, so the rule is testable without the Durable Object
 * runtime (2026-09, S-308's campaign automation).
 *
 * Lives at the top level of `src/` beside `solver-container.ts` for the same reason the other
 * container wiring does: `steiger` does not inspect top-level files, and this is deployment topology.
 */

/** What `SolverContainer.stopIfIdle()` did, and why. */
export type StopOutcome = "not-running" | "busy" | "unknown" | "stop";

/**
 * **Stricter than the sleep path, on purpose.** `onActivityExpired` lets an unreadable probe count as
 * idle, because a container nobody can prove busy must be allowed to sleep eventually. An operator stop
 * is a deliberate act, so "could not tell" (`null`) refuses rather than risking a live solve.
 *
 * `activeJobs` is ignored when the container is not running: nothing was probed, because probing a
 * stopped container starts it.
 */
export const decideStop = (running: boolean, activeJobs: number | null): StopOutcome => {
  if (!running) return "not-running";
  if (activeJobs === null) return "unknown";
  return activeJobs > 0 ? "busy" : "stop";
};

/**
 * `SolverContainer.status()`'s answer. Tuning values only — never a credential, never anything out of
 * `envVars` beyond the four tuning numbers.
 *
 * `effectiveTuning` is what the NEXT cold start would receive. A warm container keeps the values it
 * booted with, so this is intent; the job row's `solver_config` is the fact.
 */
export type SolverContainerStatus = {
  readonly running: boolean;
  /** The SDK's own state machine, read from Durable Object storage — no request reaches the container. */
  readonly state: string;
  /** Epoch milliseconds of the SDK state's last change. */
  readonly lastChange: number;
  readonly effectiveTuning: EffectiveTuning;
  /** The class's configured `sleepAfter`, so a lifecycle command can check what is deployed. */
  readonly sleepAfter: string | number;
};

export type StopIfIdleResult = { readonly outcome: StopOutcome };

/** The two operator methods, as the route consumes them — the Durable Object stub satisfies this. */
export type SolverContainerControl = {
  status(): Promise<SolverContainerStatus>;
  stopIfIdle(): Promise<StopIfIdleResult>;
};
