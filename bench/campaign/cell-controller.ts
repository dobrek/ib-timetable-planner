import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CellTuning, HostFingerprint } from "../campaign-cell.ts";
import type { SolverContainerStatus, StopIfIdleResult, StopOutcome } from "../../src/solver-container-ops.ts";
import type { CalibrationKey } from "../../src/solver-container-env.ts";
import { CALIBRATION_KEYS } from "../../src/solver-container-env.ts";
import { MAIN_CELL } from "./definition.ts";
import type { AppClient } from "./http-client.ts";
import { childEnv, run } from "./process-lifetime.ts";

/**
 * Everything production-specific the runner reasons from, behind one interface — so the local
 * rehearsal drives the SAME state machine against a native solver, and the production run differs
 * only in which implementation `main.ts` constructs.
 *
 * | Question            | Production                                      | Local                              |
 * |---------------------|-------------------------------------------------|------------------------------------|
 * | apply a cell        | `wrangler secret bulk`, then `status()` agrees  | remember the cell's env            |
 * | stop if idle        | the operator route                              | `/jobs/active`, then kill the solver |
 * | running?            | `status().running`                              | the solver's port still answers    |
 * | before a dispatch   | nothing — the dispatch starts the container     | start the solver if it is down     |
 * | live version        | `wrangler deployments list --json`              | `local`                            |
 * | expected host       | `x86_64`, pinned to the first run's CPU count   | any                                |
 *
 * **Intent versus fact.** `readStatus()` reports what the NEXT cold start would receive; a warm
 * container keeps what it booted with. The runner uses this to decide when to dispatch, and the job
 * row's `solver_config` to decide whether a run counts.
 */
export type CellController = {
  readStatus(): Promise<ControllerStatus>;
  /** Set the cell and return once the controller reports it as the next cold start's tuning. */
  applyCell(tuning: CellTuning): Promise<void>;
  /** Remove the override (`main`'s constants again) and verify it is gone. */
  park(): Promise<void>;
  stopIfIdle(): Promise<StopOutcome>;
  beforeDispatch(): Promise<void>;
  liveVersion(): Promise<string>;
  /** The host pattern a recorded run must match (`hostMatches`), or null for any. */
  expectedHost(firstHost: HostFingerprint | null): string | null;
};

export type ControllerStatus = {
  readonly running: boolean;
  readonly tuning: CellTuning;
  readonly overridden: readonly string[];
  /** The deployed class's `sleepAfter` — what the renewal command checks; null locally. */
  readonly sleepAfter: string | number | null;
};

/** How long a secret change may take to show in `status()` before the runner halts instead. */
const TUNING_WAIT_MS = 180_000;
const TUNING_POLL_MS = 5_000;

export type ProductionControllerOptions = {
  readonly client: AppClient;
  readonly stateDir: string;
  readonly sleep: (ms: number) => Promise<void>;
};

export const createProductionController = ({
  client,
  stateDir,
  sleep,
}: ProductionControllerOptions): CellController => {
  const readStatus = async (): Promise<ControllerStatus> => {
    const status = await client.getJson<SolverContainerStatus>(CONTROL_ROUTE);
    return {
      running: status.running,
      tuning: {
        workers: status.effectiveTuning.workers,
        stageBudgetS: status.effectiveTuning.stageBudgetS,
        modeABudgetS: status.effectiveTuning.modeABudgetS,
      },
      overridden: status.effectiveTuning.overridden,
      sleepAfter: status.sleepAfter,
    };
  };

  /** One atomic `secret bulk`, then poll `status()` until it reflects the change — or halt. */
  const setSecrets = async (
    payload: Record<CalibrationKey, string | null>,
    settled: (status: ControllerStatus) => boolean,
  ) => {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, `secrets-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(payload));
    try {
      await run("pnpm", ["exec", "wrangler", "secret", "bulk", file]);
    } finally {
      rmSync(file, { force: true });
    }
    const deadline = Date.now() + TUNING_WAIT_MS;
    while (Date.now() < deadline) {
      if (settled(await readStatus())) return;
      await sleep(TUNING_POLL_MS);
    }
    throw new Error(
      `status() did not reflect the secret change within ${TUNING_WAIT_MS / 1000} s — halting rather than dispatching`,
    );
  };

  return {
    readStatus,
    applyCell: (tuning) =>
      setSecrets(
        secretBulkPayload(tuning),
        (status) => tuningMatches(status.tuning, tuning) && status.overridden.length === CALIBRATION_KEYS.length,
      ),
    park: () => setSecrets(secretBulkPayload(null), (status) => status.overridden.length === 0),
    stopIfIdle: async () =>
      (await client.postJson<StopIfIdleResult>(CONTROL_ROUTE, { action: "stop-if-idle" })).outcome,
    beforeDispatch: () => Promise.resolve(),
    liveVersion: async () =>
      latestVersion(JSON.parse(await run("pnpm", ["exec", "wrangler", "deployments", "list", "--json"])) as unknown),
    expectedHost: (firstHost) => (firstHost === null ? "x86_64/*" : `x86_64/${firstHost.cpuCount ?? "?"}`),
  };
};

export type LocalControllerOptions = {
  readonly stateDir: string;
  /** Where the solver reaches Supabase, as `solver:dev` needs it. */
  readonly solverEnv: {
    readonly SUPABASE_URL: string;
    readonly SUPABASE_KEY: string;
    readonly SOLVER_MACHINE_PASSWORD: string;
  };
  readonly solverUrl: string;
  readonly sleep: (ms: number) => Promise<void>;
};

/**
 * The rehearsal's container: a native solver this controller starts and stops itself, in its own
 * process group so it outlives a killed runner exactly as a container would. Applying a cell only
 * records it — like a Worker secret, it reaches the solver at its next START, so a solver left running
 * under the old cell solves the next job under the old cell, and the rehearsal sees the same
 * wrong-cell run production would.
 */
export const createLocalController = ({
  stateDir,
  solverEnv,
  solverUrl,
  sleep,
}: LocalControllerOptions): CellController => {
  const statePath = join(stateDir, "local-solver.json");
  const read = (): LocalSolverState =>
    existsSync(statePath)
      ? (JSON.parse(readFileSync(statePath, "utf8")) as LocalSolverState)
      : { desired: null, pid: null };
  const write = (next: LocalSolverState): void => {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`);
  };
  const alive = (pid: number | null): boolean => pid !== null && isAlive(pid);

  return {
    // Running means the PORT is taken, not just that our launcher lives: a stopped solver's uvicorn
    // can still be answering for a moment while it shuts down, and a dispatch that reached it would
    // solve under the old cell.
    readStatus: async () => {
      const { desired, pid } = read();
      return {
        running: alive(pid) || (await answersHealth(solverUrl)),
        tuning: desired ?? MAIN_CELL.tuning,
        overridden: desired === null ? [] : [...CALIBRATION_KEYS],
        sleepAfter: null,
      };
    },
    applyCell: (tuning) => {
      write({ ...read(), desired: tuning });
      return Promise.resolve();
    },
    park: () => {
      write({ ...read(), desired: null });
      return Promise.resolve();
    },
    stopIfIdle: async () => {
      const { pid } = read();
      // Something answering on the port that this controller did not start would take the
      // rehearsal's jobs under ITS env; "unknown" halts instead of racing it.
      if (pid === null || !alive(pid)) return (await answersHealth(solverUrl)) ? "unknown" : "not-running";
      const active = await activeJobs(solverUrl);
      if (active === null) return "unknown";
      if (active > 0) return "busy";
      process.kill(-pid, "SIGTERM");
      return "stop";
    },
    beforeDispatch: async () => {
      const state = read();
      if (alive(state.pid)) return;
      const tuning = state.desired ?? MAIN_CELL.tuning;
      const pid = startSolver(stateDir, { ...solverEnv, ...solverTuningEnv(tuning) });
      write({ ...state, pid });
      await waitForHealth(solverUrl, () => isAlive(pid), sleep);
    },
    liveVersion: () => Promise.resolve("local"),
    expectedHost: () => null,
  };
};

/** The JSON `wrangler secret bulk` takes: the cell's three values, or three nulls to delete them. */
export const secretBulkPayload = (tuning: CellTuning | null): Record<CalibrationKey, string | null> => ({
  CALIBRATION_WORKERS: tuning === null ? null : String(tuning.workers),
  CALIBRATION_STAGE_BUDGET_S: tuning === null ? null : String(tuning.stageBudgetS),
  CALIBRATION_MODE_A_BUDGET_S: tuning === null ? null : String(tuning.modeABudgetS),
});

export const tuningMatches = (actual: CellTuning, wanted: CellTuning): boolean =>
  actual.workers === wanted.workers &&
  actual.stageBudgetS === wanted.stageBudgetS &&
  actual.modeABudgetS === wanted.modeABudgetS;

/**
 * The live Worker version(s) from `wrangler deployments list --json`: the newest deployment's
 * versions as `id@percent`, comma-joined. Recorded at dispatch and at terminal, so a deploy that
 * landed mid-run shows in the journal.
 */
export const latestVersion = (deployments: unknown): string => {
  if (!Array.isArray(deployments) || deployments.length === 0) throw new Error("wrangler listed no deployments");
  const newest = (deployments as Deployment[]).reduce((latest, candidate) =>
    candidate.created_on > latest.created_on ? candidate : latest,
  );
  return newest.versions.map((version) => `${version.version_id}@${version.percentage}`).join(",");
};

// --- helpers --------------------------------------------------------------------------------------

const CONTROL_ROUTE = "/api/solver/container";

type Deployment = {
  readonly created_on: string;
  readonly versions: readonly { readonly version_id: string; readonly percentage: number }[];
};

type LocalSolverState = { readonly desired: CellTuning | null; readonly pid: number | null };

const solverTuningEnv = (tuning: CellTuning): Record<string, string> => ({
  SOLVER_WORKERS: String(tuning.workers),
  SOLVER_STAGE_BUDGET_S: String(tuning.stageBudgetS),
  SOLVER_MODE_A_BUDGET_S: String(tuning.modeABudgetS),
});

/** `solver:dev`'s own launcher, detached into its own process group and logging under the state dir. */
const startSolver = (stateDir: string, env: Record<string, string>): number => {
  mkdirSync(stateDir, { recursive: true });
  const log = openSync(join(stateDir, "local-solver.log"), "a");
  const child = spawn("sh", ["scripts/solver/dev.sh"], {
    env: { ...childEnv(), ...env },
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  child.unref();
  if (child.pid === undefined) throw new Error("the local solver did not start");
  return child.pid;
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const activeJobs = async (solverUrl: string): Promise<number | null> => {
  try {
    const response = await fetch(new URL("/jobs/active", solverUrl), { signal: AbortSignal.timeout(5_000) });
    const body = (await response.json()) as { active?: unknown };
    return typeof body.active === "number" ? body.active : null;
  } catch {
    return null;
  }
};

const answersHealth = (solverUrl: string): Promise<boolean> =>
  fetch(new URL("/health", solverUrl), { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.ok)
    .catch(() => false);

const waitForHealth = async (solverUrl: string, stillAlive: () => boolean, sleep: (ms: number) => Promise<void>) => {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!stillAlive())
      throw new Error("the local solver exited before answering /health — see .campaign/local-solver.log");
    if (await answersHealth(solverUrl)) return;
    await sleep(1_000);
  }
  throw new Error("the local solver did not answer /health within 90 s");
};
