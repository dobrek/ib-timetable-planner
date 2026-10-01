import type { LedgerRow } from "./campaign-ledger";
import { bestSpreadCells, fallbackFactOf, groupByTier, median, renderTable } from "./generation-jobs-report";

/**
 * The cross-cell matrix: what the Cell D choice is read from.
 *
 * Tier by cell, flattened into one row per (tier, cell) so that the cells of one tier sit on
 * consecutive lines — the comparison a reader actually makes is "at tier 3, what did another minute
 * buy?", never "what did cell B do across the ladder?". Then one row per cell for its clocks.
 *
 * Only runs that COUNT enter the statistics. Excluded runs are not silently dropped either: each
 * cell states how many it left out, because a cell whose three valid runs took five attempts is a
 * different fact from one that took three.
 *
 * It does not judge. There is no "winner" column, no threshold and no ranking — choosing Cell D is a
 * human decision made against this table.
 */
export const formatCampaignMatrix = (rows: readonly LedgerRow[]): string => {
  const cells = cellsInOrder(rows);
  if (cells.length === 0) return "**Cross-cell matrix**\n\n(no attributed runs)";
  const counted = rows.filter(countsInMatrix);
  const tiers = groupByTier(counted).map((group) => ({ tier: group.tier, name: group.name }));
  return [
    "**Cross-cell matrix** (counted runs only)",
    "",
    ...renderTable(
      ["tier", "name", "cell", "runs", "best min", "best median", "best max", "OPTIMAL", "budget", "median s"],
      tiers.flatMap(({ tier, name }) => cells.map((cell) => tierCellRow(counted, tier, name, cell))),
      "markdown",
    ),
    "",
    "**Per-cell clocks**",
    "",
    ...renderTable(
      [
        "cell",
        "counted",
        "excluded",
        "queue→claim median s",
        "end-to-end min / median / max min",
        "Σ wallClockS median min",
        "unaccounted median / max s",
        "fallback fired",
      ],
      cells.map((cell) => clockRow(rows, cell)),
      "markdown",
    ),
  ].join("\n");
};

/** Cells in the order the campaign first ran them — A, B, C, D in practice — rather than by key. */
const cellsInOrder = (rows: readonly LedgerRow[]): string[] => [
  ...new Set(rows.map((row) => row.cell).filter((cell): cell is string => cell !== null)),
];

const countsInMatrix = (row: LedgerRow): boolean => row.excluded === null && row.cell !== null;

const tierCellRow = (counted: readonly LedgerRow[], tier: number, name: string, cell: string): string[] => {
  const stages = counted
    .filter((row) => row.cell === cell)
    .flatMap((row) => row.stages.filter((stage) => stage.tier === tier));
  return [
    String(tier),
    name,
    cell,
    String(stages.length),
    ...bestSpreadCells(stages),
    String(stages.filter((stage) => stage.status === "OPTIMAL").length),
    String(stages.filter((stage) => stage.stoppedBy === "budget").length),
    stages.length === 0 ? "—" : median(stages.map((stage) => stage.wallClockS)).toFixed(2),
  ];
};

const clockRow = (rows: readonly LedgerRow[], cell: string): string[] => {
  const inCell = rows.filter((row) => row.cell === cell);
  const counted = inCell.filter(countsInMatrix);
  const endToEnd = present(counted.map((row) => row.clocks.endToEndS)).map((seconds) => seconds / 60);
  const unaccounted = present(counted.map((row) => row.clocks.unaccountedS));
  return [
    cell,
    String(counted.length),
    String(inCell.length - counted.length),
    medianOrDash(present(counted.map((row) => row.clocks.queueToClaimS)), 1),
    endToEnd.length === 0
      ? "—"
      : `${Math.min(...endToEnd).toFixed(2)} / ${median(endToEnd).toFixed(2)} / ${Math.max(...endToEnd).toFixed(2)}`,
    medianOrDash(
      counted.map((row) => row.clocks.stageSumS / 60),
      2,
    ),
    unaccounted.length === 0 ? "—" : `${median(unaccounted).toFixed(1)} / ${Math.max(...unaccounted).toFixed(1)}`,
    String(counted.filter((row) => fallbackFactOf(row.solverConfig) === "fired").length),
  ];
};

const present = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

const medianOrDash = (values: readonly number[], digits: number): string =>
  values.length === 0 ? "—" : median(values).toFixed(digits);
