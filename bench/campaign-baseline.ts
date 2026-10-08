import type { LedgerRow } from "./campaign-ledger";
import { bestSpreadCells, groupByTier, renderTable } from "./generation-jobs-report";

/**
 * The S-309 quality baseline: the shipped cell's per-tier `best` spread, the exact tuples its runs
 * delivered, and the job ids they came from — the documented PRODUCTION reference. Nothing asserts
 * against it: its instance is a deleted production plan that cannot be committed. The executable
 * tripwire is `services/solver/tests/test_baseline.py`, on a committed instance.
 *
 * Dated, because a baseline is a measurement of one catalog on one day, and an undated one is read as
 * a standing truth. `date` is the caller's, so this stays pure.
 *
 * Every counted run's tuple is listed, not just one: which run's board becomes "the" delivered
 * baseline is the author's call, made with all of them in view.
 */
export const formatBaseline = (rows: readonly LedgerRow[], cell: string, date: string): string => {
  const runs = rows.filter((row) => row.cell === cell && row.excluded === null);
  const header = `**S-309 baseline — cell \`${cell}\` — recorded ${date}**`;
  if (runs.length === 0) return `${header}\n\n(no counted runs in this cell)`;
  return [
    header,
    "",
    `Runs: ${runs.map((row) => `${row.run ?? "—"} \`${row.jobId}\``).join(", ")}`,
    "",
    ...renderTable(
      ["tier", "name", "runs", "best min", "best median", "best max"],
      groupByTier(runs).map((group) => [
        String(group.tier),
        group.name,
        String(group.stages.length),
        ...bestSpreadCells(group.stages),
      ]),
      "markdown",
    ),
    "",
    "Delivered tuples:",
    "",
    ...runs.map(
      (row) =>
        `- run ${row.run ?? "—"} \`${row.jobId}\`: ${row.deliveredObjective === null ? "not computed" : `[${row.deliveredObjective.join(", ")}]`}`,
    ),
  ].join("\n");
};
