import type { StoredStageReport } from "@/entities/timetable";

/**
 * The calibration campaign's tables, built as pure strings so `generation-jobs.analyze.ts` stays a
 * thin loader and the tables stay diffable across runs — the same split `plan-report.ts` uses, and
 * for the same reason: a second copy of the column order would drift the moment a column moved.
 *
 * It reports; it never judges. There is no verdict here and no threshold on `best` — which budget
 * ships is a product call made against a ledger, not something a formatter gets to imply. The one
 * flag it does raise is arithmetic, not opinion: when a succeeded row's own clock exceeds the
 * transcript's by more than fixed overhead, a solve may have happened that the transcript cannot
 * show (see :func:`formatJobReport`).
 */
export type JobReport = {
  readonly id: string;
  /** `policy.preset` — which of the ladder's visit orders this run used. */
  readonly preset: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly stages: readonly StoredStageReport[];
};

/**
 * One job as the ledger pastes it: the clocks, then a row per completed ladder stage.
 *
 * **The two clocks are printed side by side deliberately, with their difference.** `finished_at −
 * started_at` is what the author waited; `Σ wallClockS` is what the transcript accounts for. They
 * differ by the fixed overheads — sign-in, snapshot parse, the terminal write — and by one thing
 * that is not overhead: the clean-mode infeasibility fallback re-solves Mode A, and only the second
 * solve's time reaches the tier-1 transcript. That hidden solve is BOUNDED by the Mode A budget,
 * never equal to it — the fallback fires only on a proven INFEASIBLE, which by definition returned
 * before the deadline — so the fingerprint is a gap wider than overhead alone, not wider than a
 * budget. `modeABudgetS` names the bound in the flag; `OVERHEAD_ALLOWANCE_S` is the threshold.
 *
 * Only a `succeeded` row is flagged. A reclaimed, cancelled or failed row's clock measures the
 * outage or the author's patience, not a solve, and a flag that blamed the fallback for those would
 * put a wrong cause in the ledger.
 */
export const formatJobReport = (job: JobReport, modeABudgetS: number): string =>
  [
    `=== job ${job.id} · ${job.preset} · ${job.status} ===`,
    `started  ${job.startedAt ?? "—"}`,
    `finished ${job.finishedAt ?? "—"}`,
    clockLine(job),
    ...unaccountedLines(job, modeABudgetS),
    "",
    ...tierTable(job.stages),
  ].join("\n");

/**
 * Every selected job collapsed to one row per tier — the table the budget decision is read off.
 *
 * `best` is summarised as min/median/max rather than averaged because two identical solves land on
 * incomparable boards (the POC measured it), so a mean would invent a precision the runs do not
 * have. The OPTIMAL / budget-stopped counts are the other half of the same question: a tier that
 * proves optimality inside its budget cannot be improved by giving it more.
 */
export const formatTierSummary = (jobs: readonly JobReport[]): string => {
  const tiers = groupByTier(jobs);
  if (tiers.length === 0) return `=== per-tier summary across ${jobs.length} job(s) ===\n(no stages recorded)`;
  return [
    `=== per-tier summary across ${jobs.length} job(s) ===`,
    ...renderTable(
      ["tier", "name", "runs", "best min", "best median", "best max", "OPTIMAL", "budget", "median s"],
      tiers.map(summaryCells),
    ),
  ].join("\n");
};

// --- clocks ---------------------------------------------------------------------------------------

type TierGroup = { readonly tier: number; readonly name: string; readonly stages: readonly StoredStageReport[] };

/**
 * What a solve costs outside its stages: sign-in, snapshot parse, model build, the terminal write.
 * Locally that is a few seconds; 30 s leaves the container room to be slower. A guess until Phase 3
 * records the production figure — revisit it then, against the campaign's own unaccounted column.
 */
const OVERHEAD_ALLOWANCE_S = 30;

const clockLine = (job: JobReport): string => {
  const elapsed = elapsedSeconds(job);
  const accounted = stageSeconds(job.stages);
  const wall = elapsed === null ? "—" : `${minutes(elapsed)} min`;
  const unaccounted = elapsed === null ? "—" : `${(elapsed - accounted).toFixed(1)} s`;
  return `end-to-end ${wall} · Σ wallClockS ${minutes(accounted)} min · unaccounted ${unaccounted}`;
};

/**
 * The flag, and nothing when there is nothing to flag — a formatter that always printed a line about
 * the fallback would train the reader to skip it. The number itself is always on the clock line.
 */
const unaccountedLines = (job: JobReport, modeABudgetS: number): string[] => {
  if (job.status !== "succeeded") return [];
  const elapsed = elapsedSeconds(job);
  if (elapsed === null) return [];
  const unaccounted = elapsed - stageSeconds(job.stages);
  if (unaccounted <= OVERHEAD_ALLOWANCE_S) return [];
  return [
    `! ${unaccounted.toFixed(1)} s unaccounted for — more than the ${OVERHEAD_ALLOWANCE_S} s of fixed overhead.`,
    "  A solve may have run that the transcript cannot show: the clean-mode infeasibility fallback",
    `  re-solves Mode A after a proven INFEASIBLE, costing less than the ${modeABudgetS} s Mode A budget,`,
    "  and only the second solve reaches the tier-1 stage report.",
  ];
};

const elapsedSeconds = (job: JobReport): number | null => {
  if (job.startedAt === null || job.finishedAt === null) return null;
  const from = Date.parse(job.startedAt);
  const to = Date.parse(job.finishedAt);
  return Number.isNaN(from) || Number.isNaN(to) ? null : (to - from) / 1000;
};

const stageSeconds = (stages: readonly StoredStageReport[]): number =>
  stages.reduce((total, stage) => total + stage.wallClockS, 0);

const minutes = (seconds: number): string => (seconds / 60).toFixed(2);

// --- tables ---------------------------------------------------------------------------------------

const tierTable = (stages: readonly StoredStageReport[]): string[] =>
  stages.length === 0
    ? ["(no stages recorded)"]
    : renderTable(["tier", "name", "status", "best", "bound", "wallClockS", "stoppedBy"], stages.map(stageCells));

const stageCells = (stage: StoredStageReport): string[] => [
  String(stage.tier),
  stage.name,
  stage.status,
  numberOrDash(stage.best),
  numberOrDash(stage.bound),
  stage.wallClockS.toFixed(2),
  stage.stoppedBy ?? "—",
];

const summaryCells = (group: TierGroup): string[] => {
  const bests = group.stages.map((stage) => stage.best).filter((best): best is number => best !== undefined);
  return [
    String(group.tier),
    group.name,
    String(group.stages.length),
    numberOrDash(bests.length === 0 ? undefined : Math.min(...bests)),
    bests.length === 0 ? "—" : median(bests).toFixed(1),
    numberOrDash(bests.length === 0 ? undefined : Math.max(...bests)),
    String(group.stages.filter((stage) => stage.status === "OPTIMAL").length),
    String(group.stages.filter((stage) => stage.stoppedBy === "budget").length),
    median(group.stages.map((stage) => stage.wallClockS)).toFixed(2),
  ];
};

/**
 * Grouped by TIER, never by ladder position: a policy may permute the visit order (S-307), so
 * position 4 is a different question on a student-first run than on a canonical one, while the tier
 * is the stage's identity under every policy.
 */
const groupByTier = (jobs: readonly JobReport[]): TierGroup[] => {
  const stages = jobs.flatMap((job) => job.stages);
  const tiers = [...new Set(stages.map((stage) => stage.tier))].sort((a, b) => a - b);
  return tiers.map((tier) => {
    const matching = stages.filter((stage) => stage.tier === tier);
    return { tier, name: matching[0]?.name ?? "—", stages: matching };
  });
};

/** The lower-and-upper mean, so an even run count is not silently rounded toward one of them. */
const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const numberOrDash = (value: number | undefined): string => (value === undefined ? "—" : String(value));

/** Column-aligned rows, so consecutive campaign runs diff line for line rather than word for word. */
const renderTable = (headers: readonly string[], rows: readonly string[][]): string[] => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
};
