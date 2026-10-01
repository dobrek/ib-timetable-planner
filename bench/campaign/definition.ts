import type { CellTuning } from "../campaign-cell.ts";
import {
  CONTAINER_MODE_A_BUDGET_S,
  CONTAINER_STAGE_BUDGET_S,
  CONTAINER_WORKERS,
  isValidCalibrationValue,
} from "../../src/solver-container-env.ts";

/**
 * What the calibration campaign measures (S-308 Phase 4): three fixed cells at 4 workers, three
 * valid runs each, then a fourth cell a human chooses after reading the matrix.
 *
 * **Runtime rule for `bench/campaign/`.** These files execute under Node 24's native type stripping
 * (`node bench/campaign/main.ts`), while their tests run under vitest. Node resolves no `@/` alias and
 * strips types without checking them, so a runtime error here is invisible to `pnpm test`: every type
 * comes in through `import type`, only erasable syntax is used (no `enum`, `namespace` or parameter
 * properties), and relative imports carry their `.ts` extension. The two modules this file reaches
 * outside the folder import nothing themselves.
 */
export type GridCellKey = "A" | "B" | "C" | "D";

/**
 * `main` is the cell `run-one` measures: whatever `main`'s constants are, with no override. `drill` is
 * the lifecycle drill's own solve: Cell C's tuning, deliberately interrupted, and never a grid slot.
 */
export type CampaignCellKey = GridCellKey | "main" | "drill";

export type CampaignCell = { readonly key: CampaignCellKey; readonly tuning: CellTuning };

/** Where the campaign runs. A journal is bound to one target at setup and never changes it. */
export type CampaignTarget = "production" | "local";

export const RUNS_PER_CELL = 3;

/**
 * S-308's grid: Mode A stays at 300 s and the stage budget moves — 120 s is the shipped default,
 * 60 s and 240 s bracket it.
 */
const PRODUCTION_CELLS: readonly CampaignCell[] = [
  { key: "A", tuning: { workers: 4, stageBudgetS: 120, modeABudgetS: 300 } },
  { key: "B", tuning: { workers: 4, stageBudgetS: 60, modeABudgetS: 300 } },
  { key: "C", tuning: { workers: 4, stageBudgetS: 240, modeABudgetS: 300 } },
];

/**
 * The same grid at a twentieth of the stage budget, so a local rehearsal of every path — resume,
 * retry, pause, cleanup — takes minutes rather than an afternoon. The ORDER and the shape are what
 * the rehearsal proves; its numbers mean nothing.
 */
const REHEARSAL_CELLS: readonly CampaignCell[] = [
  { key: "A", tuning: { workers: 4, stageBudgetS: 6, modeABudgetS: 300 } },
  { key: "B", tuning: { workers: 4, stageBudgetS: 3, modeABudgetS: 300 } },
  { key: "C", tuning: { workers: 4, stageBudgetS: 12, modeABudgetS: 300 } },
];

/** `main`'s constants, read from the forwarding rule itself so the two can never disagree. */
export const MAIN_CELL: CampaignCell = {
  key: "main",
  tuning: {
    workers: Number(CONTAINER_WORKERS),
    stageBudgetS: Number(CONTAINER_STAGE_BUDGET_S),
    modeABudgetS: Number(CONTAINER_MODE_A_BUDGET_S),
  },
};

/** The cells in campaign order: A, B, C, then D once a human has chosen it. */
export const gridFor = (target: CampaignTarget, cellD: CellTuning | null): CampaignCell[] => [
  ...(target === "production" ? PRODUCTION_CELLS : REHEARSAL_CELLS),
  ...(cellD === null ? [] : [{ key: "D" as const, tuning: cellD }]),
];

export const cellByKey = (grid: readonly CampaignCell[], key: CampaignCellKey): CampaignCell | undefined => {
  if (key === "main") return MAIN_CELL;
  // The drill solves under the 240 s cell: long enough that a deploy lands mid-ladder (research §7).
  if (key === "drill") return grid.find((cell) => cell.key === "C");
  return grid.find((cell) => cell.key === key);
};

/**
 * Why a proposed Cell D would be refused, or nothing. The Worker applies an override only inside these
 * same bounds and silently falls back to the constant outside them, so a cell it would ignore must be
 * refused here rather than discovered as a run on the wrong cell.
 */
export const cellTuningProblems = ({ workers, stageBudgetS, modeABudgetS }: CellTuning): string[] =>
  [
    isValidCalibrationValue("CALIBRATION_WORKERS", workers) ? null : `workers ${workers} is outside 1–16 or not whole`,
    isValidCalibrationValue("CALIBRATION_STAGE_BUDGET_S", stageBudgetS)
      ? null
      : `stage ${stageBudgetS} s is outside 1–1800`,
    isValidCalibrationValue("CALIBRATION_MODE_A_BUDGET_S", modeABudgetS)
      ? null
      : `Mode A ${modeABudgetS} s is outside 1–3600`,
  ].filter((problem): problem is string => problem !== null);

/** Ten tiers: Mode A (tier 1) under its own budget, then nine polishing stages under the stage budget. */
const POLISHING_STAGES = 9;

/**
 * What one run costs, in seconds. `expected` assumes Mode A proves completeness in about a minute and
 * every polishing stage runs to its budget — the research's figures for an empty board, so a cloned
 * board comes in under them. `worst` lets Mode A use its whole budget and adds a cold start.
 */
export const estimateRunSeconds = ({
  stageBudgetS,
  modeABudgetS,
}: CellTuning): { expected: number; worst: number } => ({
  expected: POLISHING_STAGES * stageBudgetS + 60,
  worst: modeABudgetS + POLISHING_STAGES * stageBudgetS + 120,
});
