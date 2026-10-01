/* eslint-disable no-console -- the console IS the runner's operator interface (bench precedent). */
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { cellKeyOf } from "../campaign-cell.ts";
import type { CellTuning } from "../campaign-cell.ts";
import { createAnalyzerClient } from "./analyzer-client.ts";
import { createLocalController, createProductionController } from "./cell-controller.ts";
import { cellTuningProblems, gridFor } from "./definition.ts";
import { createAppClient } from "./http-client.ts";
import { readJournal, replay } from "./journal.ts";
import type { CampaignState, JournalAction } from "./journal.ts";
import { drill, renewal, verifyStartup } from "./lifecycle.ts";
import { cleanupStep, gridComplete, nextStep } from "./next-step.ts";
import {
  cellsOf,
  missingFrom,
  now,
  perform,
  record,
  requireEnv,
  runLoop,
  safeToChangeSecrets,
  sleep,
} from "./runner.ts";
import type { Context, RunnerConfig } from "./runner.ts";
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
 *   verify-startup                          the deployed container's latest startup line (read-only)
 *   drill                                   the attended deploy-during-solve drill (production)
 *   renewal                                 Cell A run 1 under sleepAfter = 10m, and the five numbers
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
const COMMANDS = [
  "status",
  "setup",
  "run",
  "set-cell",
  "run-one",
  "park",
  "resume",
  "cleanup",
  "verify-startup",
  "drill",
  "renewal",
] as const;

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
  if (command === "verify-startup") return verifyStartup(config);
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
  if (command === "drill") return drill(context, state);
  if (command === "renewal") return renewal(context, state);
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

const confirm = async (prompt: string, word: string): Promise<boolean> => {
  if (process.env.CAMPAIGN_CLEANUP_CONFIRM === word) return true;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(prompt)).trim() === word;
  } finally {
    readline.close();
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
