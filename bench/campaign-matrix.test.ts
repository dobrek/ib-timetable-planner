import { describe, expect, it } from "vitest";
import type { StoredSolverConfig, StoredStageReport } from "@/entities/timetable";
import { mergeLedger, toLedgerRow, type LoadedJob } from "./campaign-ledger";
import { formatCampaignMatrix } from "./campaign-matrix";

/**
 * The Cell D choice is read off this table, so it must compare like with like (counted runs only,
 * grouped by tier identity), say how many runs it left out, and invent no precision.
 */
const config = (stageBudgetS: number): StoredSolverConfig => ({
  version: 1,
  workers: 4,
  stageBudgetS,
  modeABudgetS: 300,
  seed: 0,
  budgetSource: { stage: "configured", modeA: "configured" },
  targets: {},
  preset: "clean",
  cleanMode: true,
  host: { machine: "x86_64", cpuCount: 4, ortools: "9.12.4544" },
  cleanFallback: false,
});

const slots = (best: number, overrides: Partial<StoredStageReport> = {}): StoredStageReport => ({
  tier: 3,
  name: "totalSlots",
  status: "FEASIBLE",
  best,
  wallClockS: 120,
  stoppedBy: "budget",
  ...overrides,
});

/** A run created at minute `at` past ten, under a stage budget, with its transcript. */
const run = (
  at: number,
  stageBudgetS: number,
  stages: StoredStageReport[],
  overrides: Partial<LoadedJob> = {},
): LoadedJob => {
  const mm = String(at).padStart(2, "0");
  return {
    id: `job-${mm}`,
    planId: "plan",
    proposalPlanId: null,
    delivered: true,
    preset: "clean",
    status: "succeeded",
    createdAt: `2026-10-01T10:${mm}:00.000Z`,
    startedAt: `2026-10-01T10:${mm}:30.000Z`,
    finishedAt: `2026-10-01T11:${mm}:30.000Z`,
    stages,
    solverConfig: config(stageBudgetS),
    error: null,
    ...overrides,
  };
};

const ledgerOf = (jobs: LoadedJob[]) =>
  mergeLedger(
    [],
    jobs.map((job) => toLedgerRow(job, { cells: new Map(), requireSolverConfig: false, host: null }, null)),
  );

describe("formatCampaignMatrix", () => {
  it("puts every cell of one tier on consecutive rows, in the order the campaign ran them", () => {
    const matrix = formatCampaignMatrix(
      ledgerOf([
        run(1, 120, [slots(95)]),
        run(2, 60, [slots(99)]),
        run(3, 120, [slots(93, { status: "OPTIMAL", stoppedBy: undefined })]),
      ]),
    );
    const rows = matrix.split("\n").filter((line) => line.startsWith("| 3 "));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/\| w4-s120-a300 \| 2 +\| 93 +\| 94\.0 +\| 95 +\| 1 +\| 1 +\| 120\.00/);
    expect(rows[1]).toMatch(/\| w4-s60-a300 +\| 1 +\| 99 +\| 99\.0 +\| 99 +\| 0 +\| 1 +\| 120\.00/);
  });

  it("leaves excluded runs out of the statistics and counts them per cell", () => {
    const matrix = formatCampaignMatrix(
      ledgerOf([
        run(1, 120, [slots(95)]),
        run(2, 120, [slots(10)], { status: "interrupted", error: "interrupted by container shutdown: …" }),
      ]),
    );

    expect(matrix).toMatch(/\| 3 +\| totalSlots \| w4-s120-a300 \| 1 +\| 95 /);
    expect(matrix).toMatch(/\| w4-s120-a300 \| 1 +\| 1 +\|/);
  });

  it("reports the clocks per cell — queue wait, end-to-end spread, overhead and fallbacks", () => {
    const matrix = formatCampaignMatrix(ledgerOf([run(1, 120, [slots(95)]), run(2, 120, [slots(97)])]));

    // 30 s queue → claim, a 60-minute end-to-end, 120 s of transcript leaving 3480 s unaccounted.
    expect(matrix).toMatch(
      /\| w4-s120-a300 \| 2 +\| 0 +\| 30\.0 +\| 60\.00 \/ 60\.00 \/ 60\.00 +\| 2\.00 +\| 3480\.0 \/ 3480\.0 +\| 0 /,
    );
  });

  it("says there is nothing to compare rather than printing empty tables", () => {
    expect(formatCampaignMatrix([])).toContain("(no attributed runs)");
  });
});
