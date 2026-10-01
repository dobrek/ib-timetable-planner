/* eslint-disable no-console -- the console IS the runner's operator interface (bench precedent). */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { cellKeyOf } from "../campaign-cell.ts";
import type { CellTuning, HostFingerprint } from "../campaign-cell.ts";
import { createAnalyzerClient } from "./analyzer-client.ts";
import type { AnalyzerClient } from "./analyzer-client.ts";
import { createLocalController, createProductionController } from "./cell-controller.ts";
import type { CellController } from "./cell-controller.ts";
import { cellByKey, cellTuningProblems, gridFor } from "./definition.ts";
import type { CampaignTarget } from "./definition.ts";
import { ActionCallError, createAppClient, DISPATCH_TIMEOUT_MS, isTransient } from "./http-client.ts";
import type { AppClient } from "./http-client.ts";
import { appendEntry, readJournal, replay } from "./journal.ts";
import type { ActionResult, CampaignState, JournalAction, JournalEntry } from "./journal.ts";
import { cleanupStep, gridComplete, nextStep } from "./next-step.ts";
import type { Step } from "./next-step.ts";
import { describeAction, describeStep, formatStatus } from "./status-report.ts";

/**
 * `mise run solver:campaign -- <command>` — the calibration campaign's runner (S-308 Phase 4).
 *
 *   status                                  where the campaign stands, from the journal alone
 *   setup [--adopt <planId> | --abandon]    clone the source plan WITH its board; refuse an empty one
 *   run                                     execute steps until a pause, a halt or a graceful stop
 *   set-cell D <workers> <stageS> <modeAS>  supply Cell D after the pause
 *   run-one                                 one run under main's constants, after the grid
 *   park                                    remove the override and verify it
 *   resume                                  forgive a halt's failures and let `run` go on
 *   cleanup                                 the strict cleanup order, after a typed confirmation
 *
 * One write-ahead journal (`.campaign/journal.jsonl`) is the whole state; see `journal.ts`. Every
 * decision is `next-step.ts`; this file only performs them, and is the one place that talks to the
 * network, the shell and the operator.
 *
 * **Stopping.** The first Ctrl-C finishes the step in hand (a wait is simply abandoned — it resumes on
 * the next `run`), leaves any solve running, parks the override when that is safe, and exits. Parking
 * with a solve in flight happens only once Phase 5's drill has recorded that a secret change does not
 * disturb a running solve. A second Ctrl-C exits at once and parks nothing; `status` then shows the
 * live override.
 *
 * Runs under bare Node (type stripping) — see `definition.ts` for the import rules that implies.
 */
type RunnerConfig = {
  readonly target: CampaignTarget;
  readonly stateDir: string;
  readonly journalPath: string;
  readonly ledgerPath: string;
  readonly ledgerCopyPath: string;
};

type Context = {
  readonly config: RunnerConfig;
  readonly campaign: { readonly sourcePlanId: string; readonly name: string };
  readonly client: AppClient;
  readonly controller: CellController;
  readonly analyzer: AnalyzerClient;
  readonly stop: AbortSignal;
  readonly pollMs: number;
};

/** The part of `checkPlan`'s `GenerationJobView` the runner reads — an HTTP answer, not a row. */
type JobView = {
  readonly jobId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly delivered: boolean;
  readonly proposalPlanId: string | null;
};

const COMMANDS = ["status", "setup", "run", "set-cell", "run-one", "park", "resume", "cleanup"] as const;

const main = async (argv: readonly string[]): Promise<number> => {
  const [command = "status", ...args] = argv;
  if (!(COMMANDS as readonly string[]).includes(command)) {
    console.error(`unknown command "${command}" — one of: ${COMMANDS.join(", ")}`);
    return 1;
  }
  const config = runnerConfig();
  const state = replay(readJournal(config.journalPath));
  if (command === "status") {
    console.log(formatStatus(state, config.target, Date.now()));
    return 0;
  }
  if (command === "set-cell") return setCell(config, state, args);
  if (command === "resume") return resume(config);
  if (state.setup !== null && state.setup.target !== config.target) {
    console.error(
      `this journal belongs to a ${state.setup.target} campaign; CAMPAIGN_TARGET is ${config.target}. Refusing.`,
    );
    return 1;
  }

  const context = await connect(config);
  if (command === "setup") return setup(context, state, args);
  if (state.setup === null) {
    console.error("not set up — run `setup` first");
    return 1;
  }
  if (command === "run")
    return runLoop(
      context,
      nextStep,
      "done — the grid is complete; next: `cleanup` (or `run-one` for S-308's final check)",
    );
  if (command === "run-one") return runOne(context, state);
  if (command === "park") return parkNow(context, state);
  return cleanup(context, state);
};

// --- commands -------------------------------------------------------------------------------------

const setup = async (context: Context, state: CampaignState, args: readonly string[]): Promise<number> => {
  const { config, client, analyzer, campaign } = context;
  if (state.setup !== null) {
    console.error(`already set up: campaign plan ${state.setup.campaignPlanId}`);
    return 1;
  }
  const { pending } = state;
  if (pending !== null && pending.action.kind === "setup")
    return reconcileSetup(context, pending.seq, pending.action, args);

  const seq = state.lastSeq + 1;
  const action: JournalAction = { kind: "setup", target: config.target, ...campaign };
  record(config, { type: "intent", seq, at: now(), action });
  const { id } = await client.action<{ id: string }>("clonePlan", {
    sourcePlanId: campaign.sourcePlanId,
    name: campaign.name,
    includeBoard: true,
  });
  const remainingHours = await analyzer.remainingHours(id);
  if (remainingHours === 0) {
    await client.action("deletePlan", { id });
    record(config, { type: "outcome", seq, at: now(), result: { kind: "setup-refused", remainingHours } });
    console.error(
      `the board leaves 0 hours to place, so every Generate would fail — clone ${id} deleted, nothing set up.`,
    );
    return 1;
  }
  record(config, { type: "outcome", seq, at: now(), result: { kind: "setup", campaignPlanId: id, remainingHours } });
  console.log(`campaign plan ${id} "${campaign.name}": ${remainingHours} h to place`);
  return 0;
};

/**
 * A setup whose clone may or may not exist. It is not repeated blindly — a second clone of real
 * student data is litter — so the operator says which it was: the plan they found, or none.
 */
const reconcileSetup = async (
  context: Context,
  seq: number,
  action: Extract<JournalAction, { kind: "setup" }>,
  args: readonly string[],
): Promise<number> => {
  const { config, analyzer } = context;
  const [flag = "", planId = ""] = args;
  if (flag === "--adopt" && planId !== "") {
    const remainingHours = await analyzer.remainingHours(planId);
    record(config, {
      type: "outcome",
      seq,
      at: now(),
      result: { kind: "setup", campaignPlanId: planId, remainingHours },
    });
    console.log(`adopted campaign plan ${planId}: ${remainingHours} h to place`);
    return 0;
  }
  if (flag === "--abandon") {
    record(config, { type: "outcome", seq, at: now(), result: { kind: "setup-refused", remainingHours: null } });
    console.log("the interrupted setup is abandoned; run `setup` again");
    return 0;
  }
  console.error(
    `a setup was interrupted after asking to clone "${action.name}". Look for that plan in the plans list:\n` +
      `  found it → setup --adopt <planId>\n  not there → setup --abandon`,
  );
  return 1;
};

const setCell = (config: RunnerConfig, state: CampaignState, args: readonly string[]): number => {
  const [cell = "", ...values] = args;
  const [workers = Number.NaN, stageBudgetS = Number.NaN, modeABudgetS = Number.NaN] = values.map(Number);
  if (cell !== "D" || values.length !== 3) {
    console.error("usage: set-cell D <workers> <stageS> <modeAS>");
    return 1;
  }
  const tuning: CellTuning = { workers, stageBudgetS, modeABudgetS };
  const problems = cellTuningProblems(tuning);
  if (problems.length > 0) {
    console.error(`refused — the Worker would ignore this override: ${problems.join("; ")}`);
    return 1;
  }
  if (state.attempts.some((attempt) => attempt.cell === "D")) {
    console.error("Cell D has already been dispatched; it can no longer change");
    return 1;
  }
  record(config, { type: "set-cell", at: now(), cell: "D", tuning });
  console.log("grid:");
  for (const each of gridFor(state.setup?.target ?? config.target, tuning))
    console.log(`  ${each.key}  ${cellKeyOf(each.tuning)}`);
  return 0;
};

const resume = (config: RunnerConfig): number => {
  record(config, { type: "resume", at: now() });
  console.log(`resumed — next: ${describeStep(nextStep(replay(readJournal(config.journalPath))))}`);
  return 0;
};

const runOne = async (context: Context, state: CampaignState): Promise<number> => {
  if (!gridComplete(state)) {
    console.error("run-one measures main's constants after the grid — finish the grid (A–D) first");
    return 1;
  }
  // A run-one interrupted part-way is continued, not requested a second time.
  const satisfied = new Set(
    state.attempts
      .filter((attempt) => attempt.cell === "main" && attempt.verdict?.counts === true)
      .map((attempt) => attempt.slot),
  ).size;
  if (satisfied >= state.runOneRequests) record(context.config, { type: "run-one", at: now() });
  return runLoop(context, nextStep, "done — the run under main's constants is recorded");
};

const parkNow = async (context: Context, state: CampaignState): Promise<number> => {
  if (state.pending !== null && state.pending.action.kind !== "park") {
    console.error(`"${describeAction(state.pending.action)}" was interrupted — \`run\` reconciles it first`);
    return 1;
  }
  if (!(await safeToChangeSecrets(context, state))) return 1;
  await perform(context, state, { kind: "park" }, state.pending);
  return 0;
};

const cleanup = async (context: Context, state: CampaignState): Promise<number> => {
  const { config, analyzer } = context;
  const setupState = state.setup;
  if (setupState === null) return 1;
  const dispatched = state.attempts.map((attempt) => attempt.jobId).filter((id): id is string => id !== null);
  // Once the campaign plan is gone its rows are gone too; the checks below already passed back then.
  if (!state.cleanedUp.deleted.includes(setupState.campaignPlanId) && dispatched.length > 0) {
    await analyzer.extractLedger({
      ledgerPath: config.ledgerPath,
      jobIds: dispatched,
      cells: cellsOf(state),
      expectedHost: context.controller.expectedHost(state.firstHost),
    });
    const missing = missingFrom(config.ledgerPath, dispatched);
    if (missing.length > 0) {
      console.error(
        `the ledger lacks ${missing.length} dispatched job(s): ${missing.join(", ")} — refusing to delete their rows`,
      );
      return 1;
    }
    if (missingFrom(config.ledgerCopyPath, dispatched).length > 0) {
      console.error(
        `the merged ledger is the campaign's only record once the rows are deleted. Copy and commit it first:\n` +
          `  cp ${config.ledgerPath} ${config.ledgerCopyPath}`,
      );
      return 1;
    }
  }
  const proposals = new Set(state.attempts.map((attempt) => attempt.proposalPlanId).filter((id) => id !== null)).size;
  if (
    !(await confirm(
      `Type 'delete' to deliver and delete ${proposals} proposal(s), then campaign plan ${setupState.campaignPlanId}: `,
      "delete",
    ))
  ) {
    console.error("aborted — nothing was deleted");
    return 1;
  }
  return runLoop(context, cleanupStep, "cleanup complete — no campaign plan, proposal or override remains");
};

// --- the loop -------------------------------------------------------------------------------------

/** Replay → decide → perform, until the decision is not an action or a stop was asked for. */
const runLoop = async (
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
const perform = async (
  context: Context,
  state: CampaignState,
  action: JournalAction,
  reconcile: { readonly seq: number; readonly at: string } | null,
): Promise<boolean> => {
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
      if (!(await waitUntilIdle(context, state))) return null;
      await controller.applyCell(action.tuning);
      return { kind: "apply-cell" };
    case "park":
      if (!(await waitUntilIdle(context, state))) return null;
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
      });
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
  const adoptable = (view: JobView): boolean =>
    !state.attempts.some((attempt) => attempt.jobId === view.jobId) &&
    Date.parse(view.createdAt) >= Date.parse(intentAt) - CLOCK_SKEW_MS;
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
  if (!(await safeToChangeSecrets(context, state))) {
    log(`stopped — cell ${state.override.cell}'s override is STILL LIVE; \`park\` once nothing is solving`);
    return 0;
  }
  log("→ park the override before exiting");
  const parked = await perform({ ...context, stop: new AbortController().signal }, state, { kind: "park" }, null);
  log(parked ? "stopped — override parked" : "stopped — the park did not complete; `status` shows the override");
  return 0;
};

/**
 * A secret change deploys a new Worker version. Until the drill shows that leaves a running solve
 * alone, the runner changes secrets only when nothing on ANY plan is solving.
 */
const safeToChangeSecrets = async (context: Context, state: CampaignState): Promise<boolean> => {
  if (state.secretChangeDisturbsSolve === false) return true;
  const { blocking } = await context.analyzer.activeJobs();
  if (blocking.length === 0) return true;
  log(
    `  ${blocking.length} job(s) solving (${blocking.map((entry) => entry.jobId).join(", ")}) — not changing secrets under them`,
  );
  return false;
};

/** Before a secret change: wait — not fail — for every active job on every plan to end. */
const waitUntilIdle = async (context: Context, state: CampaignState): Promise<boolean> =>
  (await pollUntil(
    context,
    async () => ((await safeToChangeSecrets(context, state)) ? true : null),
    Number.POSITIVE_INFINITY,
    60_000,
  )) === true;

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
  });
  const start = text.indexOf("**Cross-cell matrix**");
  return start === -1 ? text : text.slice(start);
};

// --- plumbing -------------------------------------------------------------------------------------

const ACTIVE: readonly string[] = ["queued", "running"];

/** Laptop clock versus database clock: an adopted job may look a little older than its intent. */
const CLOCK_SKEW_MS = 120_000;

class TransientError extends Error {}

const checkPlan = (client: AppClient, planId: string): Promise<JobView | null> =>
  client.action<JobView | null>("checkPlan", { planId });

/** Every journaled job's cell key, so a wrong-cell run is excluded by the ledger itself. */
const cellsOf = (state: CampaignState): Map<string, string> => {
  const grid = gridFor(state.setup?.target ?? "production", state.cellD);
  return new Map(
    state.attempts.flatMap((attempt) => {
      const cell = cellByKey(grid, attempt.cell);
      return attempt.jobId === null || cell === undefined ? [] : [[attempt.jobId, cellKeyOf(cell.tuning)] as const];
    }),
  );
};

type LedgerFileRow = {
  readonly jobId: string;
  readonly excluded: string | null;
  readonly solverConfig: { readonly host: { readonly machine: string; readonly cpuCount: number | null } } | null;
};

const ledgerRows = (path: string): LedgerFileRow[] =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { rows: LedgerFileRow[] }).rows : [];

const ledgerRow = (path: string, jobId: string): { excluded: string | null; host: HostFingerprint | null } => {
  const row = ledgerRows(path).find((candidate) => candidate.jobId === jobId);
  if (row === undefined) throw new Error(`the ledger has no row for job ${jobId} after extracting it`);
  return { excluded: row.excluded, host: row.solverConfig?.host ?? null };
};

const missingFrom = (path: string, jobIds: readonly string[]): string[] => {
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
const pollUntil = async <T>(
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
const sleep = (ms: number, signal?: AbortSignal): Promise<boolean> =>
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

const confirm = async (prompt: string, word: string): Promise<boolean> => {
  if (process.env.CAMPAIGN_CLEANUP_CONFIRM === word) return true;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(prompt)).trim() === word;
  } finally {
    readline.close();
  }
};

const record = (config: RunnerConfig, entry: JournalEntry): void => {
  appendEntry(config.journalPath, entry);
};

const now = (): string => new Date().toISOString();

const log = (line: string): void => {
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

// --- wiring ---------------------------------------------------------------------------------------

/** Paths and the target, which every command needs — `status` included, so nothing secret is read here. */
const runnerConfig = (): RunnerConfig => {
  const target = (process.env.CAMPAIGN_TARGET ?? "production") === "local" ? "local" : "production";
  const stateDir = process.env.CAMPAIGN_STATE_DIR ?? ".campaign";
  return {
    target,
    stateDir,
    journalPath: join(stateDir, "journal.jsonl"),
    ledgerPath: join(stateDir, "ledger.json"),
    // A rehearsal must never write its numbers into S-308's record.
    ledgerCopyPath:
      process.env.CAMPAIGN_LEDGER_COPY ??
      (target === "production"
        ? "context/changes/production-calibration-campaign/ledger.json"
        : join(stateDir, "ledger-copy.json")),
  };
};

/** Everything that reaches the network, built from the launcher's environment and signed in. */
const connect = async (config: RunnerConfig): Promise<Context> => {
  const env = requireEnv([
    "CAMPAIGN_BASE_URL",
    "CAMPAIGN_EMAIL",
    "CAMPAIGN_PASSWORD",
    "CAMPAIGN_SOURCE_PLAN_ID",
    "ANALYZER_SUPABASE_URL",
    "ANALYZER_SERVICE_ROLE_KEY",
    ...(config.target === "local"
      ? ["LOCAL_SOLVER_SUPABASE_URL", "LOCAL_SOLVER_SUPABASE_KEY", "LOCAL_SOLVER_MACHINE_PASSWORD"]
      : []),
  ]);
  const client = createAppClient({
    baseUrl: env.CAMPAIGN_BASE_URL,
    email: env.CAMPAIGN_EMAIL,
    password: env.CAMPAIGN_PASSWORD,
  });
  await client.signIn();
  const pause = (ms: number): Promise<void> => sleep(ms).then(() => undefined);
  const controller =
    config.target === "production"
      ? createProductionController({ client, stateDir: config.stateDir, sleep: pause })
      : createLocalController({
          stateDir: config.stateDir,
          solverUrl: process.env.LOCAL_SOLVER_URL ?? "http://127.0.0.1:8000",
          solverEnv: {
            SUPABASE_URL: env.LOCAL_SOLVER_SUPABASE_URL,
            SUPABASE_KEY: env.LOCAL_SOLVER_SUPABASE_KEY,
            SOLVER_MACHINE_PASSWORD: env.LOCAL_SOLVER_MACHINE_PASSWORD,
          },
          sleep: pause,
        });
  return {
    config,
    campaign: {
      sourcePlanId: env.CAMPAIGN_SOURCE_PLAN_ID,
      name: `Calibration — ${process.env.CAMPAIGN_NAME ?? new Date().toISOString().slice(0, 10)}`,
    },
    client,
    controller,
    analyzer: createAnalyzerClient({
      supabaseUrl: env.ANALYZER_SUPABASE_URL,
      serviceRoleKey: env.ANALYZER_SERVICE_ROLE_KEY,
      allowRemote: config.target === "production",
    }),
    stop: stopSignal(),
    pollMs: config.target === "production" ? 30_000 : 5_000,
  };
};

const requireEnv = <K extends string>(keys: readonly K[]): Record<K, string> => {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0)
    throw new Error(`missing from the environment: ${missing.join(", ")} (the launcher reads .envs/campaign.vars)`);
  return Object.fromEntries(keys.map((key) => [key, process.env[key] ?? ""])) as Record<K, string>;
};

/** First Ctrl-C (or SIGTERM): finish the step, then stop. Second: exit at once, parking nothing. */
const stopSignal = (): AbortSignal => {
  const controller = new AbortController();
  const onSignal = (): void => {
    if (controller.signal.aborted) {
      console.log("\nexiting now — nothing parked; `status` shows any live override");
      process.exit(130);
    }
    console.log("\nstopping after this step (Ctrl-C again to exit at once)");
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return controller.signal;
};

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    console.error("The journal keeps any interrupted step; `run` reconciles it.");
    process.exitCode = 1;
  },
);
