/* eslint-disable no-console -- the console IS the runner's operator interface (bench precedent). */
import { execFile, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { gridFor } from "./definition.ts";
import { DRILL_MIN_CHECKPOINT, drillProblems, haltedLabelPattern, nextDrillStep } from "./drill.ts";
import type { DrillStep } from "./drill.ts";
import { readJournal, replay } from "./journal.ts";
import type { Attempt, CampaignState, DrillFact } from "./journal.ts";
import { formatLifecycleBlock, lifecycleNumbers, renewalProblems } from "./lifecycle-numbers.ts";
import type { JobClocks, LifecycleInput } from "./lifecycle-numbers.ts";
import { nextStep } from "./next-step.ts";
import type { Step } from "./next-step.ts";
import { checkPlan, ledgerRows, log, now, perform, pollUntil, record, requireEnv, runLoop } from "./runner.ts";
import type { Context, LedgerFileRow, RunnerConfig } from "./runner.ts";
import { describeStep } from "./status-report.ts";
import { createTelemetryClient } from "./telemetry.ts";
import type { TelemetryClient } from "./telemetry.ts";
import { parseLines, startupTuning } from "./telemetry-lines.ts";
import type { ParsedTelemetry } from "./telemetry-lines.ts";

/**
 * S-308 Phase 3's attended commands — the lifecycle proof the campaign stands on:
 *
 *   verify-startup   the deployed container's most recent startup line (S-308 check 1.5), read-only
 *   drill            the deploy-during-solve drill, step by step (see `drill.ts`)
 *   renewal          one Cell A solve under `sleepAfter = "10m"`, the renewal and idle-sleep lines,
 *                    and the five production numbers as a dated block for S-308's `change.md`
 *
 * They read production's logs through the Telemetry API (`telemetry.ts`) and write only through the
 * runner's journaled `perform`, so a drill interrupted by a closed lid resumes where it stopped.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const verifyStartup = async (config: RunnerConfig): Promise<number> => {
  const telemetry = telemetryFor(config);
  const lines = parseLines(
    await telemetry.lines({
      source: "container",
      fromMs: Date.now() - 7 * DAY_MS,
      toMs: Date.now(),
      contains: "solver service starting:",
    }),
  );
  const latest = lines
    .flatMap((line) =>
      line.parsed.kind === "startup" ? [{ timestamp: line.timestamp, values: line.parsed.values }] : [],
    )
    .at(-1);
  if (latest === undefined) {
    console.error(
      "no container startup line in the last 7 days (the logs' retention): the container has not cold-started " +
        "since. It starts on the next dispatch; run verify-startup after it.",
    );
    return 1;
  }
  const tuning = startupTuning(latest.values);
  console.log(`most recent container cold start: ${new Date(latest.timestamp).toISOString()}`);
  console.log(
    `  workers=${tuning.workers ?? "?"} stage_budget_s=${tuning.stageBudgetS ?? latest.values.stage_budget_s ?? "?"} ` +
      `mode_a_budget_s=${tuning.modeABudgetS ?? latest.values.mode_a_budget_s ?? "?"} stage_targets=${tuning.stageTargets ?? "?"} ` +
      `max_concurrent_jobs=${latest.values.max_concurrent_jobs ?? "?"} credential_configured=${latest.values.credential_configured ?? "?"} ` +
      `wire_contract=${latest.values.wire_contract ?? "?"}`,
  );
  return 0;
};

export const drill = async (context: Context, state: CampaignState): Promise<number> => {
  if (context.config.target !== "production") {
    console.error("the drill deploys the real Worker — it runs against production only");
    return 1;
  }
  if (!state.attempts.some((attempt) => attempt.cell === "drill")) {
    const problems = drillProblems(await drillPreconditions(context));
    if (problems.length > 0) {
      console.error(`the drill cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
      return 1;
    }
  }
  const telemetry = telemetryFor(context.config);
  for (;;) {
    const current = replay(readJournal(context.config.journalPath));
    if (context.stop.aborted) {
      log("drill paused — `drill` resumes it; any override stays live (`status` shows it)");
      return 0;
    }
    const step = nextDrillStep(current, cellOf(current, "C"), cellOf(current, "A").tuning);
    log(`→ drill: ${describeDrillStep(step)}`);
    const outcome = await performDrillStep(context, telemetry, current, step);
    if (outcome !== null) return outcome;
  }
};

export const renewal = async (context: Context, state: CampaignState): Promise<number> => {
  if (context.config.target !== "production") {
    console.error("renewal observes production's container lifecycle — it runs against production only");
    return 1;
  }
  const { sleepAfter } = await context.controller.readStatus();
  if (sleepAfter !== "10m") {
    console.error(
      `renewal proves sleepAfter = "10m"; the deployed class says ${JSON.stringify(sleepAfter)}. ` +
        "Shipping 10m is S-308 Phase 3's own step — deploy it, then run renewal.",
    );
    return 1;
  }
  if (cellARun(state) === undefined) {
    const code = await runLoop(context, untilCellARunRecorded, "Cell A run 1 recorded");
    if (code !== 0) return code;
  }
  const finished = replay(readJournal(context.config.journalPath));
  const run = cellARun(finished);
  if (run?.jobId == null) return 1;

  // From here on nothing may touch the Worker: a control-route call constructs the Durable Object and
  // pushes the stop out by a full sleepAfter. Only the logs are read.
  log("waiting for the container to go idle and stop — telemetry only, the Worker is not touched");
  const telemetry = telemetryFor(context.config);
  const window = { fromMs: Date.parse(run.dispatchedAt) - 60_000 };
  const stoppedSeen = await pollUntil(
    context,
    async () => {
      const lines = parseLines(
        await telemetry.lines({
          source: "durable-object",
          fromMs: window.fromMs,
          toMs: Date.now(),
          contains: "[solver-container]",
        }),
      );
      return lines.some((line) => line.parsed.kind === "do-stopped") ? true : null;
    },
    45 * 60_000,
    60_000,
  );
  if (stoppedSeen === null) return 0;

  const input = await lifecycleInput(context, telemetry, finished, run.jobId, window.fromMs);
  const problems = renewalProblems(input);
  console.log(`\n${formatLifecycleBlock(lifecycleNumbers(input), input, now().slice(0, 10))}`);
  if (problems.length > 0) {
    console.error(`\nrenewal is NOT proven:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    return 1;
  }
  console.log("\nrenewal proven: a declined sleep during the solve, a succeeded row, then idle and stopped.");
  return 0;
};

// --- the drill's steps ----------------------------------------------------------------------------

/** Null to keep going; an exit code to stop. */
const performDrillStep = async (
  context: Context,
  telemetry: TelemetryClient,
  state: CampaignState,
  step: DrillStep,
): Promise<number | null> => {
  switch (step.kind) {
    case "act":
      await perform(context, state, step.action, step.reconcile);
      return null;
    case "await-checkpoint":
      return awaitCheckpoint(context, state, step.jobId);
    case "deploy":
      return deployDrillCommit(context, step.jobId);
    case "read-shutdown":
      return readShutdown(context, telemetry, state, step.jobId);
    case "check-label": {
      const view = await checkPlan(context.client, step.proposalPlanId);
      const position = view?.checkpointStageIndex ?? 0;
      const html = await context.client.getText(`/plans/${step.proposalPlanId}`);
      drillFact(context, { kind: "label", position, found: haltedLabelPattern(position).test(html) });
      return null;
    }
    case "observe-secret-change":
      record(context.config, {
        type: "observation",
        at: now(),
        key: "secret-change-during-solve",
        disturbed: step.disturbed,
      });
      log(`  ✓ a secret change under a running solve ${step.disturbed ? "DISTURBED it" : "left it alone"}`);
      return null;
    case "print-push": {
      const commit = state.drillFacts.find((candidate) => candidate.kind === "deployed");
      const sha = commit?.kind === "deployed" ? commit.commit : "<drill commit>";
      console.log(
        `\nThe drill commit ${sha} is deployed from this machine but not on origin. Push it once NO job is ` +
          "active (`status`, or ANALYZE_ACTIVE=1 pnpm analyze:jobs) — the push deploys through CI and rolls the container:\n" +
          "  git push origin main",
      );
      drillFact(context, { kind: "push-printed", commit: sha });
      return null;
    }
    case "halt":
      console.error(`DRILL HALT — ${step.reason}`);
      return 1;
    case "done":
      log("drill complete — next: `renewal` (it runs Cell A run 1)");
      return 0;
  }
};

/** Poll the campaign plan until the drill solve has a checkpoint at position 3 or later. */
const awaitCheckpoint = async (context: Context, state: CampaignState, jobId: string): Promise<number | null> => {
  const campaignPlanId = state.setup?.campaignPlanId ?? "";
  const position = await pollUntil(context, async () => {
    const view = await checkPlan(context.client, campaignPlanId);
    if (view?.jobId !== jobId)
      throw new Error(`the campaign plan's latest job is ${view?.jobId ?? "none"}, not ${jobId}`);
    const reached = view.checkpointStageIndex ?? 0;
    log(`  ${view.status}, checkpoint at position ${reached}`);
    return reached >= DRILL_MIN_CHECKPOINT || !["queued", "running"].includes(view.status) ? reached : null;
  });
  if (position === null) return null;
  if (position >= DRILL_MIN_CHECKPOINT) drillFact(context, { kind: "checkpoint", position });
  // A solve that ended before position 3 is journaled through the ordinary wait, so the drill halts on it.
  else await perform(context, state, { kind: "await-terminal", jobId }, null);
  return null;
};

/**
 * Step 3: an image-changing commit, built and deployed from this machine. A comment in the solver's
 * package changes the image; `wrangler deploy` builds it (warm, from the pre-built layers) and rolls the
 * container under the running solve. The commit stays local until step 10.
 */
const deployDrillCommit = async (context: Context, jobId: string): Promise<number | null> => {
  const marker = "services/solver/src/cpsat_service/__init__.py";
  appendFileSync(marker, `# lifecycle drill marker ${now()} (job ${jobId})\n`);
  await run("git", ["add", marker]);
  await run("git", ["commit", "-m", "chore(solver): lifecycle drill marker (image-changing, deployed during a solve)"]);
  const commit = (await run("git", ["rev-parse", "--short", "HEAD"])).trim();
  await stream("pnpm", ["build"]);
  await stream("pnpm", ["exec", "wrangler", "deploy", "--message", `lifecycle drill ${commit}`]);
  drillFact(context, { kind: "deployed", commit, version: await context.controller.liveVersion() });
  return null;
};

/** Step 5: the shutdown pair from the container's lines — they land 20–40 s after they are logged. */
const readShutdown = async (
  context: Context,
  telemetry: TelemetryClient,
  state: CampaignState,
  jobId: string,
): Promise<number | null> => {
  const attempt = state.attempts.find((candidate) => candidate.jobId === jobId);
  const fromMs = Date.parse(attempt?.dispatchedAt ?? now());
  const lines = await pollUntil(
    context,
    async () => {
      const parsed = parseLines(
        await telemetry.lines({ source: "container", fromMs, toMs: Date.now(), contains: "shutdown:" }),
      );
      return parsed.some((line) => line.parsed.kind === "shutdown-written") ? parsed : null;
    },
    10 * 60_000,
    20_000,
  );
  if (lines === null) return null;
  const asked = lines.find((line) => line.parsed.kind === "shutdown-asked");
  const written = lines.find((line) => line.parsed.kind === "shutdown-written");
  drillFact(context, {
    kind: "shutdown",
    askedAt: asked?.timestamp ?? null,
    writtenSeconds: written?.parsed.kind === "shutdown-written" ? written.parsed.seconds : null,
  });
  return null;
};

const drillPreconditions = async (context: Context) => {
  await run("git", ["fetch", "--quiet", "origin"]).catch(() => "");
  const [docker, porcelain, head, originMain, image, active] = await Promise.all([
    run("docker", ["info"]).then(
      () => true,
      () => false,
    ),
    run("git", ["status", "--porcelain"]),
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["rev-parse", "origin/main"]),
    run("docker", ["image", "inspect", "ib-solver:local"]).then(
      () => true,
      () => false,
    ),
    context.analyzer.activeJobs(),
  ]);
  return {
    dockerRunning: docker,
    treeClean: porcelain.trim() === "",
    atOriginMain: head.trim() === originMain.trim(),
    imagePrebuilt: image,
    activeJobs: active.blocking.length,
  };
};

// --- the renewal's numbers ------------------------------------------------------------------------

/** `run` until Cell A run 1 is recorded — the renewal solve, which is also a counted grid run. */
const untilCellARunRecorded = (state: CampaignState): Step =>
  cellARun(state) === undefined ? nextStep(state) : { kind: "done" };

const cellARun = (state: CampaignState): Attempt | undefined =>
  state.attempts.find((attempt) => attempt.cell === "A" && attempt.slot === 1 && attempt.verdict?.counts === true);

const lifecycleInput = async (
  context: Context,
  telemetry: TelemetryClient,
  state: CampaignState,
  renewalJobId: string,
  fromMs: number,
): Promise<LifecycleInput> => {
  const rows = ledgerRows(context.config.ledgerPath);
  const renewalRow = rows.find((row) => row.jobId === renewalJobId);
  if (renewalRow === undefined) throw new Error(`the ledger has no row for the renewal job ${renewalJobId}`);
  const drillAttempt = state.attempts.find((attempt) => attempt.cell === "drill");
  const drillRow = rows.find((row) => row.jobId === drillAttempt?.jobId);
  const label = state.drillFacts.find(
    (candidate): candidate is Extract<DrillFact, { kind: "label" }> => candidate.kind === "label",
  );
  const renewalLines = parseLines([
    ...(await telemetry.lines({ source: "durable-object", fromMs, toMs: Date.now(), contains: "[solver-container]" })),
    ...(await telemetry.lines({ source: "container", fromMs, toMs: Date.now(), contains: "solver service starting:" })),
  ]);
  const drillLines: ParsedTelemetry[] =
    drillRow === undefined
      ? []
      : parseLines(
          await telemetry.lines({
            source: "container",
            fromMs: Date.parse(drillRow.clocks.createdAt),
            toMs: Date.parse(drillRow.clocks.finishedAt ?? now()) + 120_000,
            contains: "shutdown:",
          }),
        );
  return {
    renewal: clocksOf(renewalRow, null),
    renewalLines,
    drill: drillRow === undefined ? null : clocksOf(drillRow, label?.position ?? null),
    drillLines,
    unaccounted: rows
      .filter((row) => row.excluded === null)
      .map((row) => ({ jobId: row.jobId, seconds: row.clocks.unaccountedS })),
  };
};

const clocksOf = (row: LedgerFileRow, checkpointPosition: number | null): JobClocks => ({
  jobId: row.jobId,
  status: row.status,
  createdAt: row.clocks.createdAt,
  startedAt: row.clocks.startedAt,
  finishedAt: row.clocks.finishedAt,
  checkpointPosition,
  stagesReached: row.stages.length,
});

// --- plumbing -------------------------------------------------------------------------------------

const telemetryFor = (config: RunnerConfig): TelemetryClient => {
  const env = requireEnv(["CLOUDFLARE_OBSERVABILITY_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  return createTelemetryClient({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_OBSERVABILITY_TOKEN,
    rawDir: join(config.stateDir, "telemetry"),
  });
};

const cellOf = (state: CampaignState, key: "A" | "C") => {
  const cell = gridFor(state.setup?.target ?? "production", state.cellD).find((candidate) => candidate.key === key);
  if (cell === undefined) throw new Error(`the grid has no cell ${key}`);
  return cell;
};

const drillFact = (context: Context, fact: DrillFact): void => {
  record(context.config, { type: "drill", at: now(), fact });
  log(`  ✓ drill: ${JSON.stringify(fact)}`);
};

const describeDrillStep = (step: DrillStep): string =>
  step.kind === "act" ? describeStep({ kind: "act", action: step.action, reconcile: step.reconcile }) : step.kind;

const execFileAsync = promisify(execFile);

const run = async (command: string, args: readonly string[]): Promise<string> =>
  (await execFileAsync(command, [...args], { maxBuffer: 20 * 1024 * 1024 })).stdout;

/** A long build or deploy, its output shown as it happens. */
const stream = (command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "?"}`));
    });
  });
