import { describe, expect, it } from "vitest";
import { cellKeyOf } from "../campaign-cell.ts";
import {
  CONTAINER_MODE_A_BUDGET_S,
  CONTAINER_STAGE_BUDGET_S,
  CONTAINER_WORKERS,
} from "../../src/solver-container-env.ts";
import {
  baseUrlProblems,
  cellTuningProblems,
  estimateRunSeconds,
  gridFor,
  MAIN_CELL,
  RUNS_PER_CELL,
} from "./definition.ts";

/** S-308's grid, and the bounds Cell D must respect to be applied at all. */
describe("the campaign grid", () => {
  it("is A (120 s), B (60 s), C (240 s) at 4 workers with Mode A at 300 s, three runs each", () => {
    expect(gridFor("production", null).map((cell) => `${cell.key} ${cellKeyOf(cell.tuning)}`)).toEqual([
      "A w4-s120-a300",
      "B w4-s60-a300",
      "C w4-s240-a300",
    ]);
    expect(RUNS_PER_CELL).toBe(3);
  });

  it("appends Cell D once a human has chosen it", () => {
    expect(gridFor("production", { workers: 8, stageBudgetS: 120, modeABudgetS: 300 }).at(-1)).toEqual({
      key: "D",
      tuning: { workers: 8, stageBudgetS: 120, modeABudgetS: 300 },
    });
  });

  it("rehearses the same order and shape locally, with short stages and distinct cells", () => {
    const rehearsal = gridFor("local", null);

    expect(rehearsal.map((cell) => cell.key)).toEqual(["A", "B", "C"]);
    expect(new Set(rehearsal.map((cell) => cellKeyOf(cell.tuning))).size).toBe(3);
    expect(Math.max(...rehearsal.map((cell) => cell.tuning.stageBudgetS))).toBeLessThan(30);
  });

  it("measures main's own constants for run-one", () => {
    expect(MAIN_CELL.tuning).toEqual({
      workers: Number(CONTAINER_WORKERS),
      stageBudgetS: Number(CONTAINER_STAGE_BUDGET_S),
      modeABudgetS: Number(CONTAINER_MODE_A_BUDGET_S),
    });
  });
});

describe("cellTuningProblems", () => {
  it("accepts a cell the Worker would apply", () => {
    expect(cellTuningProblems({ workers: 8, stageBudgetS: 90, modeABudgetS: 300 })).toEqual([]);
  });

  it("refuses what the Worker would silently ignore", () => {
    expect(cellTuningProblems({ workers: 2.5, stageBudgetS: 2_000, modeABudgetS: 0 })).toEqual([
      "workers 2.5 is outside 1–16 or not whole",
      "stage 2000 s is outside 1–1800",
      "Mode A 0 s is outside 1–3600",
    ]);
    expect(cellTuningProblems({ workers: Number.NaN, stageBudgetS: 120, modeABudgetS: 300 })).toHaveLength(1);
  });
});

describe("estimateRunSeconds", () => {
  it("expects nine polishing stages at budget; the worst case adds a full Mode A and a cold start", () => {
    expect(estimateRunSeconds({ workers: 4, stageBudgetS: 120, modeABudgetS: 300 })).toEqual({
      expected: 9 * 120 + 60,
      worst: 300 + 9 * 120 + 120,
    });
  });
});

describe("baseUrlProblems", () => {
  it("accepts a loopback app for a rehearsal and the deployed https app for production", () => {
    expect(baseUrlProblems("local", "http://localhost:4321")).toEqual([]);
    expect(baseUrlProblems("local", "http://127.0.0.1:4321")).toEqual([]);
    expect(baseUrlProblems("production", "https://ib-timetable-planner.dobromir-kropielnicki.workers.dev")).toEqual([]);
  });

  it("refuses a rehearsal pointed at a hosted app, which would clone real data", () => {
    expect(baseUrlProblems("local", "https://ib-timetable-planner.dobromir-kropielnicki.workers.dev")).toHaveLength(1);
    // Userinfo is not the host: this URL reaches example.com.
    expect(baseUrlProblems("local", "http://127.0.0.1:4321@example.com")).toHaveLength(1);
  });

  it("refuses production pointed at a laptop, or over plain http", () => {
    expect(baseUrlProblems("production", "https://localhost:4321")).toHaveLength(1);
    expect(baseUrlProblems("production", "http://ib-timetable-planner.dobromir-kropielnicki.workers.dev")).toHaveLength(
      1,
    );
  });

  it("refuses something that is not a URL", () => {
    expect(baseUrlProblems("production", "workers.dev")).toHaveLength(1);
  });
});
