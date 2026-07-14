/* eslint-disable no-console -- the printed report IS this runner's product (bench precedent). */
import { describe, expect, it } from "vitest";
import { loadPlanAnalysis, type LoadedPlan } from "@/_pages/plan-comparison/api";
import { createLocalSupabase } from "./local-supabase";
import { buildReport, printPlanReports } from "./plan-report";

/**
 * `pnpm analyze:plans` — the expert-vs-generated comparison, automated. Point it at one or two plan
 * ids in the local stack and it prints, per plan, the rule verdict (the **verify-gold** experiment:
 * feed an expert board to the engine's own oracle and ask "would this have been allowed?"), then the
 * feature tables side by side, via the shared renderer `plan-report.ts` (the same one
 * `pnpm experiment:generation` prints, so the tables stay diffable across runs).
 *
 *   ANALYZE_PLAN_A=<golden-id> [ANALYZE_PLAN_B=<clone-id>] pnpm analyze:plans
 *
 * It reports; it never judges. The only assertions are that loading and extraction succeeded — a
 * pass/fail bar on a metric would smuggle back the scalar score this analyzer exists to avoid.
 */
const PLAN_A = process.env.ANALYZE_PLAN_A;
const PLAN_B = process.env.ANALYZE_PLAN_B;

const USAGE =
  "Skipping plan analysis. Usage: ANALYZE_PLAN_A=<plan-id> [ANALYZE_PLAN_B=<plan-id>] pnpm analyze:plans " +
  "(needs the local Supabase stack up and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test.local).";

const ready = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && PLAN_A);

describe("plan quality analysis", () => {
  // The usage line lives inside a test on purpose: a `console.log` at collection time is swallowed
  // by the reporter, so a bare `describe.skip` would exit silently — an unhelpful no-op run.
  it.runIf(!ready)("explains how to run when no plan id is supplied", () => {
    console.log(USAGE);
    expect(ready).toBe(false);
  });

  it.runIf(ready)("extracts the feature vector of each plan and reports it", async () => {
    const reports = (await loadPlans()).map(buildReport);

    printPlanReports(reports);

    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) expect(report.features.cohorts.dp1.board.placementRows).toBeGreaterThanOrEqual(0);
  });
});

const loadPlans = async (): Promise<LoadedPlan[]> => {
  if (!PLAN_A) throw new Error(USAGE);
  const supabase = createLocalSupabase({ allowRemote: process.env.ANALYZE_ALLOW_REMOTE === "1" });
  const ids = PLAN_B ? [PLAN_A, PLAN_B] : [PLAN_A];
  return Promise.all(ids.map((id) => loadPlanAnalysis(supabase, id)));
};
