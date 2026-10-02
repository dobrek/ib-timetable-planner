/* eslint-disable no-console -- the console IS the runner's operator interface (bench precedent). */
import { existsSync, readFileSync } from "node:fs";
import { cellKeyOf } from "../campaign-cell.ts";
import type { HostFingerprint } from "../campaign-cell.ts";
import type { WorkerVersions } from "../campaign-ledger.ts";
import type { AnalyzerClient } from "./analyzer-client.ts";
import type { CellController } from "./cell-controller.ts";
import { cellByKey, gridFor } from "./definition.ts";
import type { CampaignTarget } from "./definition.ts";
import { ActionCallError, DISPATCH_TIMEOUT_MS, isTransient } from "./http-client.ts";
import type { AppClient } from "./http-client.ts";
import { appendEntry, readJournal, replay, workerVersionChanged } from "./journal.ts";
import type { ActionResult, CampaignState, JournalAction, JournalEntry } from "./journal.ts";
import type { Step } from "./next-step.ts";
import { describeAction, describeStep } from "./status-report.ts";

/**
 * The runner's machinery, shared by every command that acts: the replay → decide → perform loop, the
 * write-ahead `perform`, the executor for each journaled action, and the plumbing under them (polling,
 * retries, the ledger file, the log). `main.ts` holds the commands and the wiring; `lifecycle.ts` the
 * attended Phase 3 commands, which drive this same `perform`.
 *
 * Runs under bare Node (type stripping) — see `definition.ts` for the import rules that implies.
 */

export type RunnerConfig = {
  readonly target: CampaignTarget;
  readonly stateDir: string;
  readonly journalPath: string;
  readonly ledgerPath: string;
  readonly ledgerCopyPath: string;
};

export type Context = {
  readonly config: RunnerConfig;
  readonly campaign: { readonly sourcePlanId: string; readonly name: string };
  readonly client: AppClient;
  readonly controller: CellController;
  readonly analyzer: AnalyzerClient;
  readonly stop: AbortSignal;
  readonly pollMs: number;
};

/** The part of `checkPlan`'s `GenerationJobView` the runner reads — an HTTP answer, not a row. */
export type JobView = {
  readonly jobId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly delivered: boolean;
  readonly proposalPlanId: string | null;
  /** The ladder position whose checkpoint a halted job kept, or null. */
  readonly checkpointStageIndex: number | null;
};

// --- the loop -------------------------------------------------------------------------------------

/** Replay → decide → perform, until the decision is not an action or a stop was asked for. */
export const runLoop = async (
  context: Context,
  decide: (state: CampaignState) => Step,
  doneMessage: string,
): Promise<number> => {
  for (;;) {
    const state = replay(readJournal(context.config.journalPath));
    if (context.stop.aborted) return gracefulStop(context, state);
    const step = decide(state);
    if (step.kind !== "act") return report(context, state, step, doneMessage);
    log(`→ ${describeStep(step)}`);
    // An unsettled step was interrupted by a stop; the next pass sees the stop and parks.
    await perform(context, state, step.action, step.reconcile);
  }
};

/**
 * Intent, action, outcome. A reconciled intent keeps its `seq`, so its outcome closes it. Returns false
 * when a stop interrupted a wait or a retry: the intent stays open and the next `run` resumes it.
 */
export const perform = async (
  context: Context,
  state: CampaignState,
  action: JournalAction,
  reconcile: { readonly seq: number; readonly at: string } | null,
): Promise<boolean> => {
  if (reconcile === null && state.pending !== null) {
    // Replay keeps ONE pending intent: a new one would overwrite it, and its outcome would be lost.
    throw new Error(
      `"${describeAction(state.pending.action)}" is still open — \`run\` reconciles it before anything else`,
    );
  }
  const intent = reconcile ?? { seq: state.lastSeq + 1, at: now() };
  if (reconcile === null) record(context.config, { type: "intent", seq: intent.seq, at: intent.at, action });
  const result = await withRetries(context, () => execute(context, state, action, intent.at));
  if (result === null) return false;
  record(context.config, { type: "outcome", seq: intent.seq, at: now(), result });
  log(`  ✓ ${describeResult(result)}`);
  return true;
};

const execute = async (
  context: Context,
  state: CampaignState,
  action: JournalAction,
  intentAt: string,
): Promise<ActionResult | null> => {
  const { client, controller, analyzer, config } = context;
  switch (action.kind) {
    case "setup":
      throw new Error("a setup was interrupted — run `setup` to reconcile it");
    case "apply-cell":
      // The drill's step 9 changes the secret UNDER a running solve on purpose; every other apply waits.
      if (action.duringSolve !== true && !(await waitUntil(context, () => nothingSolving(context)))) return null;
      await controller.applyCell(action.tuning);
      return { kind: "apply-cell" };
    case "park":
      if (!(await waitUntil(context, () => safeToPark(context, state)))) return null;
      await controller.park();
      return { kind: "park" };
    case "stop-container":
      return { kind: "stop-container", outcome: await controller.stopIfIdle() };
    case "await-stopped":
      return (await pollUntil(context, async () => ((await controller.readStatus()).running ? null : true), 600_000))
        ? { kind: "await-stopped" }
        : null;
    case "dispatch":
      return dispatch(context, state, action, intentAt);
    case "await-terminal":
      return awaitTerminal(context, state, action.jobId);
    case "deliver":
      return deliver(context, state, action);
    case "record": {
      await analyzer.extractLedger({
        ledgerPath: config.ledgerPath,
        jobIds: [action.jobId],
        cells: cellsOf(state),
        expectedHost: controller.expectedHost(state.firstHost),
        versions: versionsOf(state),
      });
      const attempt = state.attempts.find((candidate) => candidate.jobId === action.jobId);
      if (attempt?.terminal != null && workerVersionChanged(attempt)) {
        log(
          `  ⚠ the Worker version changed during job ${action.jobId}: ${attempt.dispatchVersion} → ${attempt.terminal.version}`,
        );
      }
      const row = ledgerRow(config.ledgerPath, action.jobId);
      return { kind: "record", excluded: row.excluded, host: row.host };
    }
    case "cleanup-deliver":
      await client.action("checkPlan", { planId: action.proposalPlanId });
      return { kind: "cleanup-deliver" };
    case "delete-plan":
      await client.action("deletePlan", { id: action.planId });
      return { kind: "delete-plan" };
  }
};

/**
 * Dispatch, or find the dispatch that already happened. The campaign plan can have at most one active
 * job, so a job on it that the journal has never seen, created after this intent, IS this dispatch —
 * whether the laptop closed before its outcome was written or the request timed out after the server
 * acted. Anything else active on the plan is someone else's solve, and the runner will not race it.
 */
const dispatch = async (
  context: Context,
  state: CampaignState,
  action: Extract<JournalAction, { kind: "dispatch" }>,
  intentAt: string,
): Promise<ActionResult> => {
  const { client, controller } = context;
  const campaignPlanId = state.setup?.campaignPlanId ?? "";
  const adoptable = (view: JobView): boolean => isAdoptable(state, view, intentAt);
  const adopt = async (view: JobView): Promise<ActionResult> => ({
    kind: "dispatch",
    jobId: view.jobId,
    proposalPlanId: view.proposalPlanId,
    liveVersion: await controller.liveVersion(),
    adopted: true,
  });

  const before = await checkPlan(client, campaignPlanId);
  if (before !== null && adoptable(before)) return adopt(before);
  if (before !== null && ACTIVE.includes(before.status)) {
    throw new Error(`job ${before.jobId} is already active on the campaign plan — refusing to dispatch over it`);
  }

  await controller.beforeDispatch();
  const liveVersion = await controller.liveVersion();
  try {
    const started = await client.action<{ jobId: string; proposalPlanId: string }>(
      "startGeneration",
      { planId: campaignPlanId },
      { timeoutMs: DISPATCH_TIMEOUT_MS },
    );
    return {
      kind: "dispatch",
      jobId: started.jobId,
      proposalPlanId: started.proposalPlanId,
      liveVersion,
      adopted: false,
    };
  } catch (error) {
    if (!(error instanceof ActionCallError)) throw error;
    // The server answered. A failed dispatch still leaves a `failed` row behind it — adopt that, so the
    // run is recorded like any other bad outcome; with no row at all, record the refusal itself.
    const after = await checkPlan(client, campaignPlanId);
    if (after !== null && adoptable(after)) return adopt(after);
    return { kind: "dispatch-failed", error: `${error.code}: ${error.message}`, liveVersion };
  }
};

/**
 * Whether a job found on the campaign plan IS the dispatch this intent began: one the journal has never
 * seen, created after the intent (less the laptop-to-server clock skew). An older unknown job is not —
 * adopting it would file someone else's solve, or an orphan, as this run.
 */
export const isAdoptable = (state: CampaignState, view: JobView, intentAt: string): boolean =>
  !state.attempts.some((attempt) => attempt.jobId === view.jobId) &&
  Date.parse(view.createdAt) >= Date.parse(intentAt) - CLOCK_SKEW_MS;

/** `checkPlan` on the campaign plan: the app's own reclaim runs, so a dead container ends as `interrupted`. */
const awaitTerminal = async (context: Context, state: CampaignState, jobId: string): Promise<ActionResult | null> => {
  const campaignPlanId = state.setup?.campaignPlanId ?? "";
  const terminal = await pollUntil(context, async () => {
    const view = await checkPlan(context.client, campaignPlanId);
    if (view?.jobId !== jobId) {
      throw new Error(`the campaign plan's latest job is ${view?.jobId ?? "none"}, not ${jobId}`);
    }
    return ACTIVE.includes(view.status) ? null : view.status;
  });
  return terminal === null
    ? null
    : { kind: "await-terminal", status: terminal, liveVersion: await context.controller.liveVersion() };
};

/** Visit the proposal — the same visit that delivers in the app. A succeeded job must come back delivered. */
const deliver = async (
  context: Context,
  state: CampaignState,
  action: Extract<JournalAction, { kind: "deliver" }>,
): Promise<ActionResult> => {
  const status = state.attempts.find((attempt) => attempt.jobId === action.jobId)?.terminal?.status ?? "unknown";
  if (action.proposalPlanId === null) return { kind: "deliver", delivered: false, status };
  const view = await checkPlan(context.client, action.proposalPlanId);
  if (view === null) return { kind: "deliver", delivered: false, status };
  if (view.status === "succeeded" && !view.delivered)
    throw new TransientError(`job ${action.jobId} succeeded but is not delivered yet`);
  return { kind: "deliver", delivered: view.delivered, status: view.status };
};

/**
 * What a stop leaves behind. The override is parked when nothing could be disturbed by the secret
 * change, and left — said out loud — when something could.
 */
const gracefulStop = async (context: Context, state: CampaignState): Promise<number> => {
  if (state.override === null) {
    log("stopped — no override is live");
    return 0;
  }
  if (state.pending !== null && state.pending.action.kind !== "park") {
    log(
      `stopped — "${describeAction(state.pending.action)}" is still open, so cell ${state.override.cell}'s override is STILL LIVE; \`run\` reconciles it, then \`park\``,
    );
    return 0;
  }
  if (!(await safeToPark(context, state))) {
    log(`stopped — cell ${state.override.cell}'s override is STILL LIVE; \`park\` once nothing is solving`);
    return 0;
  }
  log("→ park the override before exiting");
  const parked = await perform(
    { ...context, stop: new AbortController().signal },
    state,
    { kind: "park" },
    state.pending,
  );
  log(parked ? "stopped — override parked" : "stopped — the park did not complete; `status` shows the override");
  return 0;
};

/**
 * A secret change deploys a new Worker version. A park may make one under a running solve once the
 * drill has shown that leaves the solve alone; until then it waits for nothing on ANY plan to solve.
 */
export const safeToPark = async (context: Context, state: CampaignState): Promise<boolean> =>
  state.secretChangeDisturbsSolve === false || nothingSolving(context);

/**
 * A cell change always waits for every active job on every plan, drill or no drill: its next step is
 * `stop-if-idle`, which answers `busy` under someone else's solve — and a refused stop halts the run.
 */
const nothingSolving = async (context: Context): Promise<boolean> => {
  const { blocking } = await context.analyzer.activeJobs();
  if (blocking.length === 0) return true;
  log(
    `  ${blocking.length} job(s) solving (${blocking.map((entry) => entry.jobId).join(", ")}) — not changing secrets under them`,
  );
  return false;
};

/** Before a secret change: wait — not fail — until `ready` says it is safe. */
const waitUntil = async (context: Context, ready: () => Promise<boolean>): Promise<boolean> =>
  (await pollUntil(context, async () => ((await ready()) ? true : null), Number.POSITIVE_INFINITY, 60_000)) === true;

const report = async (
  context: Context,
  state: CampaignState,
  step: Exclude<Step, { kind: "act" }>,
  doneMessage: string,
): Promise<number> => {
  switch (step.kind) {
    case "needs-setup":
      console.error("not set up — run `setup` first");
      return 1;
    case "halt":
      console.error(`HALT — ${step.reason}\nState is saved. Fix the cause, then \`resume\` and \`run\`.`);
      return 1;
    case "pause": {
      const matrix = await matrixReport(context, state);
      console.log(
        `${matrix}\n\nPAUSED — choose Cell D from the matrix above, then:\n  set-cell D <workers> <stageS> <modeAS>\n  run`,
      );
      return 0;
    }
    case "done":
      log(doneMessage);
      return 0;
  }
};

const matrixReport = async (context: Context, state: CampaignState): Promise<string> => {
  const jobIds = state.attempts.map((attempt) => attempt.jobId).filter((id): id is string => id !== null);
  if (jobIds.length === 0) return "(no runs to compare)";
  const { report: text } = await context.analyzer.extractLedger({
    ledgerPath: context.config.ledgerPath,
    jobIds,
    cells: cellsOf(state),
    expectedHost: context.controller.expectedHost(state.firstHost),
    versions: versionsOf(state),
  });
  const start = text.indexOf("**Cross-cell matrix**");
  return start === -1 ? text : text.slice(start);
};

// --- plumbing -------------------------------------------------------------------------------------

export const ACTIVE: readonly string[] = ["queued", "running"];

/** Laptop clock versus database clock: an adopted job may look a little older than its intent. */
const CLOCK_SKEW_MS = 120_000;

class TransientError extends Error {}

export const checkPlan = (client: AppClient, planId: string): Promise<JobView | null> =>
  client.action<JobView | null>("checkPlan", { planId });

/** Every dispatched job's Worker version at dispatch and at terminal — the ledger's copy of the journal's. */
export const versionsOf = (state: CampaignState): Map<string, WorkerVersions> =>
  new Map(
    state.attempts.flatMap((attempt) =>
      attempt.jobId === null
        ? []
        : [
            [
              attempt.jobId,
              { dispatch: attempt.dispatchVersion, terminal: attempt.terminal?.version ?? null },
            ] as const,
          ],
    ),
  );

/** Every journaled job's cell key, so a wrong-cell run is excluded by the ledger itself. */
export const cellsOf = (state: CampaignState): Map<string, string> => {
  const grid = gridFor(state.setup?.target ?? "production", state.cellD);
  return new Map(
    state.attempts.flatMap((attempt) => {
      const cell = cellByKey(grid, attempt.cell);
      return attempt.jobId === null || cell === undefined ? [] : [[attempt.jobId, cellKeyOf(cell.tuning)] as const];
    }),
  );
};

export type LedgerFileRow = {
  readonly jobId: string;
  readonly status: string;
  readonly excluded: string | null;
  readonly clocks: {
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly unaccountedS: number | null;
  };
  readonly stages: readonly unknown[];
  readonly solverConfig: { readonly host: { readonly machine: string; readonly cpuCount: number | null } } | null;
};

export const ledgerRows = (path: string): LedgerFileRow[] =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { rows: LedgerFileRow[] }).rows : [];

const ledgerRow = (path: string, jobId: string): { excluded: string | null; host: HostFingerprint | null } => {
  const row = ledgerRows(path).find((candidate) => candidate.jobId === jobId);
  if (row === undefined) throw new Error(`the ledger has no row for job ${jobId} after extracting it`);
  return { excluded: row.excluded, host: row.solverConfig?.host ?? null };
};

export const missingFrom = (path: string, jobIds: readonly string[]): string[] => {
  const present = new Set(ledgerRows(path).map((row) => row.jobId));
  return jobIds.filter((id) => !present.has(id));
};

/**
 * Retries what the network or a 5xx broke, and nothing else — a 4xx is an answer. Between attempts it
 * waits on the stop signal, so a Ctrl-C during a retry leaves the intent open (null) instead of hanging.
 */
const withRetries = async <T>(context: Context, call: () => Promise<T | null>): Promise<T | null> => {
  const attempt = async (remaining: number): Promise<T | null> => {
    try {
      return await call();
    } catch (error) {
      if (remaining === 0 || !(isTransient(error) || error instanceof TransientError)) throw error;
      log(`  transient failure (${String(error)}) — retrying in 20 s, ${remaining} left`);
      return (await sleep(20_000, context.stop)) ? attempt(remaining - 1) : null;
    }
  };
  return attempt(5);
};

/** Poll `check` until it returns a value; null when the stop signal fired or nothing came in time. */
export const pollUntil = async <T>(
  context: Context,
  check: () => Promise<T | null>,
  timeoutMs = Number.POSITIVE_INFINITY,
  intervalMs = context.pollMs,
): Promise<T | null> => {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<T | null> => {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error(`gave up waiting after ${Math.round(timeoutMs / 1000)} s`);
    return (await sleep(intervalMs, context.stop)) ? poll() : null;
  };
  return poll();
};

/** True after the full delay; false as soon as the signal aborts. */
export const sleep = (ms: number, signal?: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const record = (config: RunnerConfig, entry: JournalEntry): void => {
  appendEntry(config.journalPath, entry);
};

export const now = (): string => new Date().toISOString();

export const log = (line: string): void => {
  console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
};

const describeResult = (result: ActionResult): string => {
  switch (result.kind) {
    case "dispatch":
      return `job ${result.jobId}${result.adopted ? " (found, not re-dispatched)" : ""} on ${result.liveVersion}`;
    case "dispatch-failed":
      return `dispatch failed: ${result.error}`;
    case "stop-container":
      return `stop-if-idle: ${result.outcome}`;
    case "await-terminal":
      return `${result.status} on ${result.liveVersion}`;
    case "deliver":
      return `${result.status}${result.delivered ? ", delivered" : ", not delivered"}`;
    case "record":
      return result.excluded === null ? "counts" : `excluded: ${result.excluded}`;
    case "setup":
      return `campaign plan ${result.campaignPlanId}`;
    default:
      return result.kind;
  }
};

/** The launcher's environment, or an error naming every key it lacks. */
export const requireEnv = <K extends string>(keys: readonly K[]): Record<K, string> => {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0)
    throw new Error(`missing from the environment: ${missing.join(", ")} (the launcher reads .envs/campaign.vars)`);
  return Object.fromEntries(keys.map((key) => [key, process.env[key] ?? ""])) as Record<K, string>;
};
