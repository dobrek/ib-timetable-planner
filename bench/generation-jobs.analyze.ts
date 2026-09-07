/* eslint-disable no-console -- the printed report IS this runner's product (bench precedent). */
import { describe, expect, it } from "vitest";
import { parseStoredPolicy, parseStoredStages } from "@/entities/timetable";
import { CONTAINER_MODE_A_BUDGET_S } from "@/solver-container-env";
import { formatJobReport, formatTierSummary, type JobReport } from "./generation-jobs-report";
import { createLocalSupabase } from "./local-supabase";

/**
 * `pnpm analyze:jobs` — the calibration campaign's extractor. Given a source plan (or explicit job
 * ids) it prints, per job, the two clocks and a row per ladder stage, then one summary row per tier
 * across the selection.
 *
 *   ANALYZE_SOURCE_PLAN=<plan-id> pnpm analyze:jobs
 *   ANALYZE_JOBS=<job-id>,<job-id> pnpm analyze:jobs
 *   ANALYZE_ALLOW_REMOTE=1 ANALYZE_JOBS=… pnpm analyze:jobs      # against the hosted project
 *   ANALYZE_MODE_A_BUDGET_S=600 ANALYZE_JOBS=… pnpm analyze:jobs  # rows solved under another Mode A
 *
 * The row records neither its budgets nor its worker count, so the Mode A bound the flag names
 * defaults to the Worker's CURRENT constant and is printed at the top of the report: a row solved
 * under an earlier cell is re-read with `ANALYZE_MODE_A_BUDGET_S` set to that cell's value, and the
 * header makes a ledger paste say which bound it was read against.
 *
 * **Read-only by construction.** The only statement it issues is a `select`, and the hosted host is
 * refused unless `ANALYZE_ALLOW_REMOTE=1` is passed explicitly — the same deliberate override
 * `analyze:plans` uses, and the same reason it exists: every campaign measurement lives on the
 * hosted project, and a bench runner that could reach it by accident is one that will.
 *
 * The projection is narrow on purpose. `snapshot` is ~100–124 KB and `result`/`checkpoint` ~35 KB
 * each; none of the three has anything to say about a budget, and PostgREST returns every column
 * when `.select()` is given none.
 *
 * It reports; it never judges. The only assertions are that loading succeeded — which budget ships
 * is a product call made against the ledger this prints, not a bar a runner gets to set.
 */
const SOURCE_PLAN = (process.env.ANALYZE_SOURCE_PLAN ?? "").trim();
const JOB_IDS = (process.env.ANALYZE_JOBS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const USAGE =
  "Skipping job analysis. Usage: ANALYZE_SOURCE_PLAN=<plan-id> pnpm analyze:jobs " +
  "(or ANALYZE_JOBS=<id>,<id>; add ANALYZE_ALLOW_REMOTE=1 for the hosted project). " +
  "Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test.local.";

/** Exactly the columns a budget question is answered from — never the three big jsonb payloads. */
const PROJECTION = "id, plan_id, status, policy, started_at, finished_at, stages, created_at";

const ready =
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  (SOURCE_PLAN.length > 0 || JOB_IDS.length > 0);

describe("generation job analysis", () => {
  // The usage line lives inside a test for the same reason it does in `plan-quality.analyze.ts`: a
  // `console.log` at collection time is swallowed by the reporter, so a bare `describe.skip` exits
  // silently — an unhelpful no-op run.
  it.runIf(!ready)("explains how to run when no plan or job id is supplied", () => {
    console.log(USAGE);
    expect(ready).toBe(false);
  });

  it.runIf(ready)("prints the per-stage transcript of each job and the per-tier summary", async () => {
    const jobs = await loadJobs();
    const modeABudgetS = modeABudget(process.env.ANALYZE_MODE_A_BUDGET_S);

    console.log(`\nMode A bound named by the flag: ${modeABudgetS} s (ANALYZE_MODE_A_BUDGET_S to override)`);
    for (const job of jobs) console.log(`\n${formatJobReport(job, modeABudgetS)}`);
    console.log(`\n${formatTierSummary(jobs)}`);

    expect(jobs.length).toBeGreaterThan(0);
  });
});

/** The override wins when it is a positive number; anything else falls back to the Worker constant. */
const modeABudget = (raw: string | undefined): number => {
  const parsed = Number(raw);
  return raw !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : Number(CONTAINER_MODE_A_BUDGET_S);
};

const loadJobs = async (): Promise<JobReport[]> => {
  const supabase = createLocalSupabase({ allowRemote: process.env.ANALYZE_ALLOW_REMOTE === "1" });
  const query = supabase.from("generation_jobs").select(PROJECTION).order("created_at", { ascending: true });
  // Job ids win when both are given: an explicit list is the more specific request, and the campaign
  // ledger addresses runs by id once a cell has been recorded.
  const { data, error } = JOB_IDS.length > 0 ? await query.in("id", JOB_IDS) : await query.eq("plan_id", SOURCE_PLAN);
  if (error) throw new Error(`Could not read generation_jobs: ${error.message}`);
  return data.map(toJobReport);
};

type JobRow = {
  id: string;
  status: string;
  policy: unknown;
  started_at: string | null;
  finished_at: string | null;
  stages: unknown;
};

/**
 * The row as the formatter takes it, through the entity's own readers for both jsonb columns —
 * never a local re-declaration of either shape, so this runner cannot drift from what the app reads
 * off the same two columns. `parseStoredPolicy` matters more than it looks: rows written before
 * S-307 carry `{ clean: true }`, and reading those as the clean preset is the honest reading (the
 * service hardcoded clean back then), where a local reader would print them as unknown.
 */
const toJobReport = (row: JobRow): JobReport => ({
  id: row.id,
  preset: parseStoredPolicy(row.policy).preset,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  stages: parseStoredStages(row.stages),
});
