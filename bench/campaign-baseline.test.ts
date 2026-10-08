import { describe, expect, it } from "vitest";
import type { StoredSolverConfig } from "@/entities/timetable";
import { formatBaseline } from "./campaign-baseline";
import { mergeLedger, toLedgerRow, type LoadedJob } from "./campaign-ledger";

/**
 * This block is the documented production reference beside S-309's executable baseline
 * (`services/solver/tests/test_baseline.py`), so it must be dated, drawn from the one cell asked for,
 * built from counted runs only, and carry every run's exact delivered tuple beside its job id.
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

const run = (
  id: string,
  at: string,
  stageBudgetS: number,
  best: number,
  overrides: Partial<LoadedJob> = {},
): LoadedJob => ({
  id,
  planId: "plan",
  proposalPlanId: null,
  delivered: true,
  preset: "clean",
  status: "succeeded",
  createdAt: `2026-10-01T${at}:00.000Z`,
  startedAt: `2026-10-01T${at}:30.000Z`,
  finishedAt: `2026-10-01T${at}:59.000Z`,
  stages: [{ tier: 3, name: "totalSlots", status: "FEASIBLE", best, wallClockS: 120, stoppedBy: "budget" }],
  solverConfig: config(stageBudgetS),
  error: null,
  ...overrides,
});

const tuple = (slots: number): number[] => [0, 0, slots, 1, 0, 2, 3, 4, 5, 6];

const ledger = mergeLedger(
  [],
  [
    toLedgerRow(
      run("a1", "10:00", 120, 95),
      { cells: new Map(), requireSolverConfig: false, host: null, versions: new Map() },
      tuple(95),
    ),
    toLedgerRow(
      run("b1", "10:30", 60, 99),
      { cells: new Map(), requireSolverConfig: false, host: null, versions: new Map() },
      tuple(99),
    ),
    toLedgerRow(
      run("a-failed", "11:00", 120, 80, { status: "failed", error: "solver error: boom" }),
      { cells: new Map(), requireSolverConfig: false, host: null, versions: new Map() },
      null,
    ),
    toLedgerRow(
      run("a2", "11:30", 120, 93),
      { cells: new Map(), requireSolverConfig: false, host: null, versions: new Map() },
      tuple(93),
    ),
  ],
);

describe("formatBaseline", () => {
  it("dates the block and draws it from the counted runs of the one cell asked for", () => {
    const baseline = formatBaseline(ledger, "w4-s120-a300", "2026-10-02");

    expect(baseline).toContain("cell `w4-s120-a300` — recorded 2026-10-02");
    expect(baseline).toContain("Runs: 1 `a1`, 2 `a2`");
    expect(baseline).not.toContain("a-failed");
    expect(baseline).not.toContain("b1");
    expect(baseline).toMatch(/\| 3 +\| totalSlots \| 2 +\| 93 +\| 94\.0 +\| 95 +\|/);
  });

  it("lists every counted run's exact delivered tuple beside its job id", () => {
    const baseline = formatBaseline(ledger, "w4-s120-a300", "2026-10-02");

    expect(baseline).toContain("- run 1 `a1`: [0, 0, 95, 1, 0, 2, 3, 4, 5, 6]");
    expect(baseline).toContain("- run 2 `a2`: [0, 0, 93, 1, 0, 2, 3, 4, 5, 6]");
  });

  it("says so when the cell has no counted run", () => {
    expect(formatBaseline(ledger, "w8-s120-a300", "2026-10-02")).toContain("(no counted runs in this cell)");
  });
});
