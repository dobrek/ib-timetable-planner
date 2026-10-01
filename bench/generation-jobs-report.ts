import type { StoredSolverConfig, StoredStageReport } from "@/entities/timetable";

/**
 * The calibration campaign's tables, built as pure strings so `generation-jobs.analyze.ts` stays a
 * thin loader and the tables stay diffable across runs — the same split `plan-report.ts` uses, and
 * for the same reason: a second copy of the column order would drift the moment a column moved.
 *
 * It reports; it never judges. There is no verdict here and no threshold on `best` — which budget
 * ships is a product call made against a ledger, not something a formatter gets to imply. The one
 * flag it does raise is arithmetic, not opinion: when a succeeded row's own clock exceeds the
 * transcript's by more than fixed overhead, a solve may have happened that the transcript cannot
 * show (see :func:`formatJobReport`). A row that RECORDS whether that solve happened
 * (`solver_config.cleanFallback`) gets the fact instead of the guess.
 *
 * The grouping, median and alignment helpers are exported because the campaign's ledger, matrix and
 * baseline formatters (`campaign-*.ts`) read the same rows the same way, and a second copy would drift.
 */
export type JobReport = {
  readonly id: string;
  /** `policy.preset` — which of the ladder's visit orders this run used. */
  readonly preset: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly stages: readonly StoredStageReport[];
  /** What the row says solved it (`generation_jobs.solver_config`); null on a legacy row. */
  readonly solverConfig: StoredSolverConfig | null;
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
 *
 * **A row that records the answer is not guessed about.** Since `solver_config` the solver writes
 * whether the fallback fired, and a policy without clean mode cannot fire it at all; either way the
 * heuristic would only add noise beside a fact. It stays for legacy rows, and for a clean-mode row
 * whose second, best-effort record write never landed — then against the row's own Mode A budget.
 */
export const formatJobReport = (job: JobReport, modeABudgetS: number): string =>
  [
    `=== job ${job.id} · ${job.preset} · ${job.status} ===`,
    `started  ${job.startedAt ?? "—"}`,
    `finished ${job.finishedAt ?? "—"}`,
    clockLine(job),
    ...configLines(job.solverConfig),
    ...fallbackLines(job, modeABudgetS),
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

/**
 * Grouped by TIER, never by ladder position: a policy may permute the visit order (S-307), so
 * position 4 is a different question on a student-first run than on a canonical one, while the tier
 * is the stage's identity under every policy.
 */
export const groupByTier = (runs: readonly { readonly stages: readonly StoredStageReport[] }[]): TierGroup[] => {
  const stages = runs.flatMap((run) => run.stages);
  const tiers = [...new Set(stages.map((stage) => stage.tier))].sort((a, b) => a - b);
  return tiers.map((tier) => {
    const matching = stages.filter((stage) => stage.tier === tier);
    return { tier, name: matching[0]?.name ?? "—", stages: matching };
  });
};

export type TierGroup = {
  readonly tier: number;
  readonly name: string;
  readonly stages: readonly StoredStageReport[];
};

/** The lower-and-upper mean, so an even run count is not silently rounded toward one of them. */
export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Column-aligned rows, so consecutive campaign runs diff line for line rather than word for word.
 *
 * `markdown` renders the same alignment as a pipe table, for the tables that are pasted into a
 * change's notes (the campaign ledger, matrix and baseline); a `|` inside a cell is escaped.
 */
export const renderTable = (
  headers: readonly string[],
  rows: readonly string[][],
  style: "plain" | "markdown" = "plain",
): string[] => {
  const escape = (cell: string): string => (style === "markdown" ? cell.replaceAll("|", "\\|") : cell);
  const body = rows.map((row) => row.map(escape));
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...body.map((row) => (row[column] ?? "").length)),
  );
  const padded = (cells: readonly string[]): string[] => cells.map((cell, column) => cell.padEnd(widths[column] ?? 0));
  const line = (cells: readonly string[]): string =>
    style === "markdown" ? `| ${padded(cells).join(" | ")} |` : padded(cells).join("  ").trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...body.map(line)];
};

/**
 * `best` across a set of stages as min / median / max cells — never a mean, for the reason
 * `formatTierSummary` gives. A stage that never found a solution contributes nothing, and a set
 * with no `best` at all reads as three dashes rather than a perfect zero.
 */
export const bestSpreadCells = (stages: readonly StoredStageReport[]): [string, string, string] => {
  const bests = stages.map((stage) => stage.best).filter((best): best is number => best !== undefined);
  if (bests.length === 0) return ["—", "—", "—"];
  return [String(Math.min(...bests)), median(bests).toFixed(1), String(Math.max(...bests))];
};

/** Seconds from one row timestamp to another; null when either is missing or unreadable. */
export const secondsBetween = (from: string | null, to: string | null): number | null => {
  if (from === null || to === null) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 1000;
};

/** What the transcript accounts for: the sum of every stage's own wall clock. */
export const stageSeconds = (stages: readonly StoredStageReport[]): number =>
  stages.reduce((total, stage) => total + stage.wallClockS, 0);

/**
 * What the row says about the clean-mode fallback. `unknown` is the only state the heuristic is
 * allowed to speak for: a legacy row, or a clean-mode row whose closing record write was lost.
 */
export type FallbackFact = "fired" | "not-fired" | "not-applicable" | "unknown";

export const fallbackFactOf = (config: StoredSolverConfig | null): FallbackFact => {
  if (config === null) return "unknown";
  if (!config.cleanMode) return "not-applicable";
  if (config.cleanFallback === undefined) return "unknown";
  return config.cleanFallback ? "fired" : "not-fired";
};

// --- clocks ---------------------------------------------------------------------------------------

/**
 * What a solve costs outside its stages: sign-in, snapshot parse, model build, the terminal write.
 * Locally that is a few seconds; 30 s leaves the container room to be slower. A guess until Phase 3
 * records the production figure — revisit it then, against the campaign's own unaccounted column.
 */
const OVERHEAD_ALLOWANCE_S = 30;

const clockLine = (job: JobReport): string => {
  const elapsed = secondsBetween(job.startedAt, job.finishedAt);
  const accounted = stageSeconds(job.stages);
  const wall = elapsed === null ? "—" : `${minutes(elapsed)} min`;
  const unaccounted = elapsed === null ? "—" : `${(elapsed - accounted).toFixed(1)} s`;
  return `end-to-end ${wall} · Σ wallClockS ${minutes(accounted)} min · unaccounted ${unaccounted}`;
};

/** The configuration line, present only when the row recorded one. */
const configLines = (config: StoredSolverConfig | null): string[] =>
  config === null
    ? []
    : [
        `config   ${config.workers} workers · stage ${config.stageBudgetS} s (${sourceLabel(config.budgetSource.stage)}) · ` +
          `Mode A ${config.modeABudgetS} s (${sourceLabel(config.budgetSource.modeA)}) · targets ${targetsLabel(config.targets)} · ` +
          `host ${config.host.machine}/${config.host.cpuCount ?? "?"} · ortools ${config.host.ortools}`,
      ];

const sourceLabel = (source: "configured" | "engine-default"): string =>
  source === "configured" ? "configured" : "engine default";

const targetsLabel = (targets: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(targets);
  return entries.length === 0 ? "none" : entries.map(([tier, value]) => `${tier}=${value}`).join(",");
};

/**
 * The recorded fact when the row has one; otherwise the heuristic flag. Stating "did not fire" is not
 * the noise the flag's silence guards against: it is what the solver wrote, and the ledger column is
 * read from the same fact.
 */
const fallbackLines = (job: JobReport, modeABudgetS: number): string[] => {
  const fact = fallbackFactOf(job.solverConfig);
  if (fact === "fired") {
    return ["clean fallback: fired (recorded by the solver) — Mode A re-solved without the clean floor"];
  }
  if (fact === "not-fired") return ["clean fallback: did not fire (recorded by the solver)"];
  if (fact === "not-applicable") return [];
  return unaccountedLines(job, job.solverConfig?.modeABudgetS ?? modeABudgetS);
};

/**
 * The flag, and nothing when there is nothing to flag — a formatter that always printed a line about
 * a GUESS would train the reader to skip it. The number itself is always on the clock line.
 */
const unaccountedLines = (job: JobReport, modeABudgetS: number): string[] => {
  if (job.status !== "succeeded") return [];
  const elapsed = secondsBetween(job.startedAt, job.finishedAt);
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

const summaryCells = (group: TierGroup): string[] => [
  String(group.tier),
  group.name,
  String(group.stages.length),
  ...bestSpreadCells(group.stages),
  String(group.stages.filter((stage) => stage.status === "OPTIMAL").length),
  String(group.stages.filter((stage) => stage.stoppedBy === "budget").length),
  median(group.stages.map((stage) => stage.wallClockS)).toFixed(2),
];

const numberOrDash = (value: number | undefined): string => (value === undefined ? "—" : String(value));
