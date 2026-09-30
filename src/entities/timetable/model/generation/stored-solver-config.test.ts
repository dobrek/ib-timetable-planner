import { describe, expect, it } from "vitest";
import { parseStoredSolverConfig } from "./stored-solver-config";

const record = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  workers: 4,
  stageBudgetS: 120,
  modeABudgetS: 300,
  seed: 1,
  budgetSource: { stage: "configured", modeA: "configured" },
  targets: {},
  preset: "clean",
  cleanMode: true,
  host: { machine: "x86_64", cpuCount: 4, ortools: "9.15.6755" },
  ...overrides,
});

describe("parseStoredSolverConfig", () => {
  it("reads a well-formed record as written", () => {
    expect(parseStoredSolverConfig(record())).toEqual(record());
  });

  it("reads the post-solve record, which adds cleanFallback", () => {
    expect(parseStoredSolverConfig(record({ cleanFallback: true }))?.cleanFallback).toBe(true);
  });

  it("keeps configured targets keyed by tier", () => {
    expect(parseStoredSolverConfig(record({ targets: { "3": 95, "6": 900 } }))?.targets).toEqual({
      "3": 95,
      "6": 900,
    });
  });

  it("accepts a host that would not report its CPU count", () => {
    const host = { machine: "arm64", cpuCount: null, ortools: "unknown" };
    expect(parseStoredSolverConfig(record({ host }))?.host.cpuCount).toBeNull();
  });

  it("reads a legacy row — no record at all — as null", () => {
    expect(parseStoredSolverConfig(null)).toBeNull();
    expect(parseStoredSolverConfig(undefined)).toBeNull();
  });

  it("refuses a version it does not know rather than misreading it", () => {
    expect(parseStoredSolverConfig(record({ version: 2 }))).toBeNull();
  });

  it("degrades a malformed object to null rather than throwing", () => {
    expect(parseStoredSolverConfig(record({ stageBudgetS: "120" }))).toBeNull();
    expect(parseStoredSolverConfig(record({ budgetSource: { stage: "guessed", modeA: "configured" } }))).toBeNull();
    expect(parseStoredSolverConfig(record({ targets: { three: 95 } }))).toBeNull();
    expect(parseStoredSolverConfig(record({ host: undefined }))).toBeNull();
    expect(parseStoredSolverConfig("solver_config")).toBeNull();
    expect(parseStoredSolverConfig([record()])).toBeNull();
  });
});
