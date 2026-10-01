/* eslint-disable no-console -- the printed report IS this runner's product (bench precedent). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isGenerationJobStatus,
  parseStoredPolicy,
  parseStoredSolverConfig,
  parseStoredStages,
  type GenerationResult,
  type GeneratorSnapshot,
} from "@/entities/timetable";
import type { SupabaseClient } from "@/shared/api";
import { loadPlanAnalysis } from "@/_pages/plan-comparison/api";
import { CONTAINER_MODE_A_BUDGET_S } from "@/solver-container-env";
import { formatAnalyzerLine } from "./analyzer-lines";
import { formatBaseline } from "./campaign-baseline";
import {
  deliveredObjective,
  formatLedgerMarkdown,
  mergeLedger,
  parseCellMapping,
  parseLedgerFile,
  serializeLedger,
  toLedgerRow,
  type LedgerExpectations,
  type LoadedJob,
} from "./campaign-ledger";
import { formatCampaignMatrix } from "./campaign-matrix";
import { classifyActiveJobs, remainingHoursOf, resolveJobIdPrefix, type ActiveRow } from "./campaign-preflight";
import { formatJobReport, formatTierSummary } from "./generation-jobs-report";
import { createLocalSupabase } from "./local-supabase";

/**
 * `pnpm analyze:jobs` — the calibration campaign's extractor of record. Given a source plan (or
 * explicit job ids) it prints, per job, the two clocks, the configuration the row says solved it and
 * a row per ladder stage, then one summary row per tier across the selection.
 *
 *   ANALYZE_SOURCE_PLAN=<plan-id> pnpm analyze:jobs
 *   ANALYZE_JOBS=<job-id>,<job-id> pnpm analyze:jobs
 *   ANALYZE_ALLOW_REMOTE=1 ANALYZE_JOBS=… pnpm analyze:jobs      # against the hosted project
 *   ANALYZE_MODE_A_BUDGET_S=600 ANALYZE_JOBS=… pnpm analyze:jobs  # legacy rows solved under another Mode A
 *   ANALYZE_TUPLES=1 ANALYZE_JOBS=… pnpm analyze:jobs             # + each succeeded job's delivered 10-tuple
 *
 * The campaign's modes, each a separate question with a `@campaign {json}` answer line for the
 * runner (`analyzer-lines.ts`) beside the human output:
 *
 *   ANALYZE_LEDGER=<path> + a selection   merge the selection into the ledger JSON at <path>; print
 *                                         the ledger, the cross-cell matrix and, with
 *                                         ANALYZE_BASELINE_CELL=<cell>, the S-309 baseline
 *   ANALYZE_ACTIVE=1                      every queued/running row on ANY plan: blocking or stale
 *   ANALYZE_JOB_PREFIX=<prefix>           the one full job id a recorded prefix names
 *   ANALYZE_REMAINING_HOURS=<plan-id>     the hours a Generate on that plan would hand the solver
 *
 * The ledger's validity rules read three more: ANALYZE_CELLS=<job>:<cell>,… (the cell each job was
 * dispatched under; the only attribution a legacy row has), ANALYZE_REQUIRE_SOLVER_CONFIG=1 (a row
 * that cannot say what solved it does not count), and ANALYZE_EXPECT_HOST=<machine>/<cpus>. Pass the
 * same three on every extraction: a merge keeps the fresh row, so the latest call's rules win.
 *
 * **Read-only by construction.** Every statement it issues is a `select`, and the hosted host is
 * refused unless `ANALYZE_ALLOW_REMOTE=1` is passed explicitly — the same deliberate override
 * `analyze:plans` uses, and the same reason it exists: every campaign measurement lives on the
 * hosted project, and a bench runner that could reach it by accident is one that will. The only
 * thing it writes is the ledger file, on this machine.
 *
 * **Ids and numbers only.** No mode prints a course, student or teacher name: the per-job report and
 * the ledger carry ids, tiers and numbers, the row's free-text `error` is reduced to a fixed kind, and
 * remaining hours is one integer.
 *
 * The status projection is narrow on purpose. `snapshot` is ~100–124 KB and `result`/`checkpoint`
 * ~35 KB each; the heavy pair is read only for the delivered tuple, and only for succeeded jobs.
 *
 * It reports; it never judges which budget ships — that is a product call made against the ledger
 * this prints. The only assertions are that loading succeeded.
 */
const env = (name: string): string => (process.env[name] ?? "").trim();

const SOURCE_PLAN = env("ANALYZE_SOURCE_PLAN");
const JOB_IDS = env("ANALYZE_JOBS")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const LEDGER_PATH = env("ANALYZE_LEDGER");
const BASELINE_CELL = env("ANALYZE_BASELINE_CELL");
const TUPLES = env("ANALYZE_TUPLES") === "1";
const ACTIVE = env("ANALYZE_ACTIVE") === "1";
const JOB_PREFIX = env("ANALYZE_JOB_PREFIX");
const REMAINING_PLAN = env("ANALYZE_REMAINING_HOURS");

const USAGE =
  "Skipping job analysis. Usage: ANALYZE_SOURCE_PLAN=<plan-id> pnpm analyze:jobs " +
  "(or ANALYZE_JOBS=<id>,<id>; ANALYZE_LEDGER=<path> to merge them into a ledger; or one of " +
  "ANALYZE_ACTIVE=1, ANALYZE_JOB_PREFIX=<prefix>, ANALYZE_REMAINING_HOURS=<plan-id>; add " +
  "ANALYZE_ALLOW_REMOTE=1 for the hosted project). Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.";

/** The columns a budget or validity question is answered from — never the three big jsonb payloads. */
const PROJECTION =
  "id, plan_id, status, policy, started_at, finished_at, stages, created_at, solver_config, error, proposal_plan_id, delivered_plan_id, delivery";

const credentials = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const selection = SOURCE_PLAN.length > 0 || JOB_IDS.length > 0;
const anyMode = selection || ACTIVE || JOB_PREFIX.length > 0 || REMAINING_PLAN.length > 0;

describe("generation job analysis", () => {
  // The usage line lives inside a test for the same reason it does in `plan-quality.analyze.ts`: a
  // `console.log` at collection time is swallowed by the reporter, so a bare `describe.skip` exits
  // silently — an unhelpful no-op run.
  it.runIf(!credentials || !anyMode)("explains how to run when nothing is asked", () => {
    console.log(USAGE);
    expect(credentials && anyMode).toBe(false);
  });

  it.runIf(credentials && selection && LEDGER_PATH.length === 0)(
    "prints the per-stage transcript of each job and the per-tier summary",
    async () => {
      const jobs = await loadJobs();
      const modeABudgetS = modeABudget(process.env.ANALYZE_MODE_A_BUDGET_S);
      const tuples = TUPLES ? await loadDeliveredTuples(jobs) : new Map<string, number[]>();

      console.log(`\nMode A bound named by the flag on legacy rows: ${modeABudgetS} s (ANALYZE_MODE_A_BUDGET_S)`);
      for (const job of jobs) {
        console.log(`\n${formatJobReport(job, modeABudgetS)}`);
        const tuple = tuples.get(job.id);
        if (tuple !== undefined) console.log(`delivered tuple [${tuple.join(", ")}]`);
      }
      console.log(`\n${formatTierSummary(jobs)}`);

      expect(jobs.length).toBeGreaterThan(0);
    },
  );

  it.runIf(credentials && selection && LEDGER_PATH.length > 0)(
    "merges the selection into the ledger file and prints the ledger, the matrix and the baseline",
    async () => {
      const jobs = await loadJobs();
      const tuples = await loadDeliveredTuples(jobs);
      const expectations = ledgerExpectations();
      const fresh = jobs.map((job) => toLedgerRow(job, expectations, tuples.get(job.id) ?? null));
      const ledger = mergeLedger(
        existsSync(LEDGER_PATH) ? parseLedgerFile(readFileSync(LEDGER_PATH, "utf8")) : [],
        fresh,
      );

      mkdirSync(dirname(LEDGER_PATH), { recursive: true });
      writeFileSync(LEDGER_PATH, serializeLedger(ledger));

      console.log(`\n${formatLedgerMarkdown(ledger)}`);
      console.log(`\n${formatCampaignMatrix(ledger)}`);
      if (BASELINE_CELL.length > 0) {
        console.log(`\n${formatBaseline(ledger, BASELINE_CELL, new Date().toISOString().slice(0, 10))}`);
      }
      console.log(
        formatAnalyzerLine({
          kind: "ledger",
          path: LEDGER_PATH,
          rows: ledger.length,
          jobIds: ledger.map((row) => row.jobId),
        }),
      );

      expect(fresh.length).toBeGreaterThan(0);
    },
  );

  it.runIf(credentials && ACTIVE)("reports every active job on any plan as blocking or stale", async () => {
    const { blocking, stale } = classifyActiveJobs(await loadActiveRows(), Date.now());

    if (blocking.length === 0 && stale.length === 0) console.log("\nno active job on any plan");
    for (const entry of blocking) {
      console.log(`BLOCKING  ${entry.status}  job ${entry.jobId}  plan ${entry.planId}  since ${entry.since ?? "—"}`);
    }
    for (const entry of stale) {
      console.log(`stale     ${entry.status}  job ${entry.jobId}  plan ${entry.planId}  since ${entry.since ?? "—"}`);
    }
    console.log(formatAnalyzerLine({ kind: "active-jobs", blocking, stale }));

    expect(true).toBe(true);
  });

  it.runIf(credentials && JOB_PREFIX.length > 0)("resolves a recorded job id prefix to the full id", async () => {
    const { data, error } = await client().from("generation_jobs").select("id");
    if (error) throw new Error(`Could not read generation_jobs: ${error.message}`);
    const jobId = resolveJobIdPrefix(
      data.map((row) => row.id),
      JOB_PREFIX,
    );

    console.log(formatAnalyzerLine({ kind: "job-id", prefix: JOB_PREFIX, jobId }));

    expect(jobId.length).toBeGreaterThan(0);
  });

  it.runIf(credentials && REMAINING_PLAN.length > 0)("prints the hours a Generate would hand the solver", async () => {
    const unplacedHours = remainingHoursOf((await loadPlanAnalysis(client(), REMAINING_PLAN)).input);

    console.log(formatAnalyzerLine({ kind: "remaining-hours", planId: REMAINING_PLAN, unplacedHours }));

    expect(unplacedHours).toBeGreaterThanOrEqual(0);
  });
});

/** The override wins when it is a positive number; anything else falls back to the Worker constant. */
const modeABudget = (raw: string | undefined): number => {
  const parsed = Number(raw);
  return raw !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : Number(CONTAINER_MODE_A_BUDGET_S);
};

const ledgerExpectations = (): LedgerExpectations => ({
  cells: parseCellMapping(env("ANALYZE_CELLS")),
  requireSolverConfig: env("ANALYZE_REQUIRE_SOLVER_CONFIG") === "1",
  host: env("ANALYZE_EXPECT_HOST") || null,
});

/** The service-role reader: local only, unless `ANALYZE_ALLOW_REMOTE=1` says otherwise out loud. */
const client = (): SupabaseClient => createLocalSupabase({ allowRemote: env("ANALYZE_ALLOW_REMOTE") === "1" });

const loadJobs = async (): Promise<LoadedJob[]> => {
  const query = client().from("generation_jobs").select(PROJECTION).order("created_at", { ascending: true });
  // Job ids win when both are given: an explicit list is the more specific request, and the campaign
  // ledger addresses runs by id once a cell has been recorded.
  const { data, error } = JOB_IDS.length > 0 ? await query.in("id", JOB_IDS) : await query.eq("plan_id", SOURCE_PLAN);
  if (error) throw new Error(`Could not read generation_jobs: ${error.message}`);
  return data.map(toLoadedJob);
};

/**
 * The exact tuple of each succeeded job's delivered board, from the heavy pair — read in one query,
 * and only for the jobs that have a `result` to score.
 */
const loadDeliveredTuples = async (jobs: readonly LoadedJob[]): Promise<Map<string, number[]>> => {
  const succeeded = jobs.filter((job) => job.status === "succeeded").map((job) => job.id);
  if (succeeded.length === 0) return new Map();
  const { data, error } = await client().from("generation_jobs").select("id, snapshot, result").in("id", succeeded);
  if (error) throw new Error(`Could not read the solved payloads: ${error.message}`);
  return new Map(
    data
      .filter((row) => row.result !== null)
      .map((row) => [
        row.id,
        deliveredObjective(row.snapshot as unknown as GeneratorSnapshot, row.result as unknown as GenerationResult),
      ]),
  );
};

const loadActiveRows = async (): Promise<ActiveRow[]> => {
  const { data, error } = await client()
    .from("generation_jobs")
    .select("id, plan_id, status, heartbeat_at, created_at")
    .in("status", ["queued", "running"]);
  if (error) throw new Error(`Could not read the active jobs: ${error.message}`);
  return data.flatMap(({ status, ...row }) => (isGenerationJobStatus(status) ? [{ ...row, status }] : []));
};

type JobRow = {
  id: string;
  plan_id: string;
  status: string;
  policy: unknown;
  started_at: string | null;
  finished_at: string | null;
  stages: unknown;
  created_at: string;
  solver_config: unknown;
  error: string | null;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  delivery: string | null;
};

/**
 * The row as the formatters take it, through the entity's own readers for every jsonb column —
 * never a local re-declaration of a shape, so this runner cannot drift from what the app reads off
 * the same columns. `parseStoredPolicy` matters more than it looks: rows written before S-307 carry
 * `{ clean: true }`, and reading those as the clean preset is the honest reading (the service
 * hardcoded clean back then), where a local reader would print them as unknown.
 *
 * `delivered` asks both markers, as the app's own delivery check does: `delivered_plan_id` is nulled
 * by its foreign key when the proposal is deleted, and `delivery` is the durable fact.
 */
const toLoadedJob = (row: JobRow): LoadedJob => ({
  id: row.id,
  planId: row.plan_id,
  proposalPlanId: row.proposal_plan_id,
  delivered: row.delivered_plan_id !== null || row.delivery !== null,
  preset: parseStoredPolicy(row.policy).preset,
  status: row.status,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  stages: parseStoredStages(row.stages),
  solverConfig: parseStoredSolverConfig(row.solver_config),
  error: row.error,
});
