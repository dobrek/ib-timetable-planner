import { z } from "zod";
import { COHORT_VALUES } from "@/shared/config";
import {
  scoreCandidate,
  storedSolverConfigSchema,
  storedStageReportSchema,
  type GenerationResult,
  type GeneratorSnapshot,
} from "@/entities/timetable";
import { cellKeyOf, hostKeyOf } from "./campaign-cell";
import {
  fallbackFactOf,
  groupByTier,
  renderTable,
  secondsBetween,
  stageSeconds,
  type JobReport,
} from "./generation-jobs-report";

/**
 * The calibration campaign's ledger: one row per job, complete enough that the job rows themselves
 * can be deleted afterwards.
 *
 * That last clause is the design constraint. Deleting the campaign's source plan cascades every one
 * of its `generation_jobs` rows (`plan_id … on delete cascade`), so once cleanup has run, the merged
 * ledger JSON committed to S-308's change folder is the only record of what the campaign measured.
 * Everything a later reader could need — the clocks, the configuration the row says solved it, the
 * per-tier transcript, the exact delivered 10-tuple — is copied in, and nothing a later reader must
 * not see is: **ids and numbers only.** The row's free-text `error` is reduced to a fixed
 * vocabulary for that reason, because a translation failure quotes a course's natural key, and that
 * key is its name.
 *
 * It reports; it never judges which cell wins. It does decide whether a run COUNTS, because that is
 * arithmetic over facts the row carries — a failed solve, a row that cannot say what solved it, a
 * cell other than the one dispatched — and the matrix must leave those runs out.
 */
export type LoadedJob = JobReport & {
  readonly planId: string;
  readonly proposalPlanId: string | null;
  /** The verified board has landed on the proposal (`delivered_plan_id` is set). */
  readonly delivered: boolean;
  readonly createdAt: string;
  readonly error: string | null;
};

/**
 * What the caller knows about a job that the row does not: which cell it was dispatched under, and
 * which host is allowed to have solved it. The campaign runner passes all three from its journal and
 * cell controller; a human reading old rows passes only the cells.
 */
export type LedgerExpectations = {
  /** Job id → the cell key it was dispatched under. For a row with `solver_config` this is checked;
   *  for a legacy row without one it is the only attribution there is. */
  readonly cells: ReadonlyMap<string, string>;
  /** Exclude a row with no `solver_config` even when `cells` names its cell — every campaign row is
   *  written by a solver that records one, so its absence is a fault, not a legacy. */
  readonly requireSolverConfig: boolean;
  /** `machine/cpuCount` the solving host must match (`hostKeyOf`); null accepts any host. */
  readonly host: string | null;
};

export const ERROR_KINDS = [
  "precondition",
  "solver-error",
  "dispatch",
  "infeasible",
  "unknown-outcome",
  "reclaimed",
  "interrupted",
  "stopped",
  "verification",
  "translation",
  "proposal-missing",
  "no-placements",
  "other",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

const clocksSchema = z.object({
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  /** `started_at − created_at`: the queue wait, which includes a cold start. */
  queueToClaimS: z.number().nullable(),
  /** `finished_at − started_at`: what the author waited once the solver had the job. */
  endToEndS: z.number().nullable(),
  /** Σ `wallClockS`: what the transcript accounts for. */
  stageSumS: z.number(),
  /** End-to-end minus the stage sum: fixed overhead, plus any solve the transcript cannot show. */
  unaccountedS: z.number().nullable(),
});

export const ledgerRowSchema = z.object({
  jobId: z.string(),
  planId: z.string(),
  proposalPlanId: z.string().nullable(),
  /** `cellKeyOf` — from `solver_config` when the row has one, otherwise from the expectations. */
  cell: z.string().nullable(),
  attribution: z.enum(["solver_config", "mapping", "none"]),
  /** 1-based position among the runs that COUNT in this cell, by creation time; null when excluded. */
  run: z.int().min(1).nullable(),
  preset: z.string(),
  status: z.string(),
  delivered: z.boolean(),
  errorKind: z.enum(ERROR_KINDS).nullable(),
  /** Null when the run counts; otherwise why it does not. Built from ids, numbers and fixed words. */
  excluded: z.string().nullable(),
  clocks: clocksSchema,
  solverConfig: storedSolverConfigSchema.nullable(),
  stages: z.array(storedStageReportSchema),
  /** The exact 10-tuple of the board a succeeded job delivered, scored with `scoreCandidate`. */
  deliveredObjective: z.array(z.int()).length(10).nullable(),
});

export type LedgerRow = z.infer<typeof ledgerRowSchema>;

/**
 * One loaded job as a ledger row, before runs are numbered (`mergeLedger` numbers them, because a
 * run's position depends on every other row in its cell).
 */
export const toLedgerRow = (
  job: LoadedJob,
  expectations: LedgerExpectations,
  deliveredObjective: readonly number[] | null,
): LedgerRow => {
  const expectedCell = expectations.cells.get(job.id) ?? null;
  const attribution = job.solverConfig !== null ? "solver_config" : expectedCell !== null ? "mapping" : "none";
  const cell = job.solverConfig !== null ? cellKeyOf(job.solverConfig) : expectedCell;
  const errorKind = errorKindOf(job.error);
  const endToEndS = secondsBetween(job.startedAt, job.finishedAt);
  const stageSumS = stageSeconds(job.stages);
  return {
    jobId: job.id,
    planId: job.planId,
    proposalPlanId: job.proposalPlanId,
    cell,
    attribution,
    run: null,
    preset: job.preset,
    status: job.status,
    delivered: job.delivered,
    errorKind,
    excluded: exclusionOf(job, { cell, attribution, errorKind, expectedCell }, expectations),
    clocks: {
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      queueToClaimS: toMillisecondsOrNull(secondsBetween(job.createdAt, job.startedAt)),
      endToEndS: toMillisecondsOrNull(endToEndS),
      stageSumS: toMilliseconds(stageSumS),
      unaccountedS: toMillisecondsOrNull(endToEndS === null ? null : endToEndS - stageSumS),
    },
    solverConfig: job.solverConfig,
    stages: [...job.stages],
    deliveredObjective: deliveredObjective === null ? null : [...deliveredObjective],
  };
};

/**
 * Fresh rows into an existing ledger, keyed by job id — so extracting the same job twice leaves one
 * row, and an extraction of a few jobs never drops the others. The fresh row wins (a job's status
 * moves until it is terminal), except that a delivered tuple once computed is kept: a succeeded
 * job's board does not change, and an extraction that skipped the heavy read should not erase it.
 *
 * Ordered by creation time, then runs numbered within each cell.
 */
export const mergeLedger = (existing: readonly LedgerRow[], fresh: readonly LedgerRow[]): LedgerRow[] => {
  const previous = new Map(existing.map((row) => [row.jobId, row]));
  const freshIds = new Set(fresh.map((row) => row.jobId));
  const updated = fresh.map((row) => ({
    ...row,
    deliveredObjective: row.deliveredObjective ?? previous.get(row.jobId)?.deliveredObjective ?? null,
  }));
  return numberRuns(byCreation([...existing.filter((row) => !freshIds.has(row.jobId)), ...updated]));
};

/** The exact tuple of the board a job delivered — the same function the 10/10 parity gate pins. */
export const deliveredObjective = (snapshot: GeneratorSnapshot, result: GenerationResult): number[] => [
  ...scoreCandidate(snapshot, result.placements, remainingOf(result)).objective,
];

/** `<job>:<cell>,<job>:<cell>` — the expectations' cell mapping as an environment value. */
export const parseCellMapping = (raw: string): Map<string, string> =>
  new Map(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [jobId = "", cell = ""] = entry.split(":").map((part) => part.trim());
        if (jobId === "" || cell === "") throw new Error(`Not a <job>:<cell> pair: "${entry}"`);
        return [jobId, cell] as const;
      }),
  );

export const parseLedgerFile = (text: string): LedgerRow[] =>
  z.object({ version: z.literal(1), rows: z.array(ledgerRowSchema) }).parse(JSON.parse(text)).rows;

export const serializeLedger = (rows: readonly LedgerRow[]): string =>
  `${JSON.stringify({ version: 1, rows }, null, 2)}\n`;

/**
 * The ledger as two pasteable tables: one row per run with its clocks, then one row per run with its
 * per-tier transcript — S-308's columns, split so neither table is too wide to read.
 */
export const formatLedgerMarkdown = (rows: readonly LedgerRow[]): string => {
  const tiers = groupByTier(rows);
  return [
    "**Runs**",
    "",
    ...renderTable(
      [
        "cell",
        "run",
        "job id",
        "preset",
        "status",
        "counts",
        "started",
        "finished",
        "queue→claim s",
        "end-to-end min",
        "Σ wallClockS min",
        "unaccounted s",
        "clean fallback",
        "delivered tuple",
      ],
      rows.map(runCells),
      "markdown",
    ),
    "",
    "**Per tier** (`best/bound status stoppedBy`)",
    "",
    ...renderTable(
      ["job id", ...tiers.map((group) => `${group.tier} ${group.name}`)],
      rows.map((row) => [row.jobId, ...tiers.map((group) => tierCell(row, group.tier))]),
      "markdown",
    ),
  ].join("\n");
};

// --- validity -------------------------------------------------------------------------------------

type Derived = {
  cell: string | null;
  attribution: LedgerRow["attribution"];
  errorKind: ErrorKind | null;
  expectedCell: string | null;
};

/** The first reason a run does not count, in the order a reader would ask. */
const exclusionOf = (job: LoadedJob, derived: Derived, expectations: LedgerExpectations): string | null => {
  if (job.status !== "succeeded") {
    return derived.errorKind === null ? `status ${job.status}` : `status ${job.status} (${derived.errorKind})`;
  }
  if (job.solverConfig === null && expectations.requireSolverConfig) return "no solver_config";
  if (derived.attribution === "none") return "unattributed: no solver_config and no cell mapping";
  if (derived.expectedCell !== null && derived.cell !== derived.expectedCell) {
    return `wrong cell: dispatched under ${derived.expectedCell}, solved under ${derived.cell ?? "—"}`;
  }
  if (expectations.host !== null && job.solverConfig !== null) {
    const host = hostKeyOf(job.solverConfig.host);
    if (host !== expectations.host) return `wrong host: ${host}, expected ${expectations.host}`;
  }
  return null;
};

/**
 * The leading words of every error the system writes to a row, mapped to a fixed kind. Anything else
 * is `other` — the text itself never enters the ledger.
 */
const ERROR_PREFIXES: readonly (readonly [string, ErrorKind])[] = [
  ["precondition:", "precondition"],
  ["solver error:", "solver-error"],
  ["dispatch failed:", "dispatch"],
  ["infeasible:", "infeasible"],
  ["unknown:", "unknown-outcome"],
  ["interrupted:", "reclaimed"],
  ["interrupted by", "interrupted"],
  ["stopped by", "stopped"],
  ["the returned board did not pass verification", "verification"],
  ["the result could not be translated", "translation"],
  ["the proposal plan no longer exists", "proposal-missing"],
  ["the solver returned a result with no placements", "no-placements"],
];

const errorKindOf = (error: string | null): ErrorKind | null => {
  if (error === null) return null;
  return ERROR_PREFIXES.find(([prefix]) => error.startsWith(prefix))?.[1] ?? "other";
};

// --- ordering -------------------------------------------------------------------------------------

const byCreation = (rows: readonly LedgerRow[]): LedgerRow[] =>
  [...rows].sort((a, b) => a.clocks.createdAt.localeCompare(b.clocks.createdAt) || a.jobId.localeCompare(b.jobId));

const counts = (row: LedgerRow): boolean => row.excluded === null && row.cell !== null;

const numberRuns = (rows: readonly LedgerRow[]): LedgerRow[] =>
  rows.map((row, index) => ({
    ...row,
    run: counts(row)
      ? rows.slice(0, index).filter((earlier) => counts(earlier) && earlier.cell === row.cell).length + 1
      : null,
  }));

// --- scoring --------------------------------------------------------------------------------------

/** Per-course remaining hours from the result's own diagnostics — tier 1 is read, never recomputed. */
const remainingOf = (result: GenerationResult): Map<string, number> =>
  new Map(
    COHORT_VALUES.flatMap((cohort) =>
      result.diagnostics.cohorts[cohort].unplaced.map((deficit) => [deficit.courseId, deficit.missing] as const),
    ),
  );

// --- markdown -------------------------------------------------------------------------------------

const runCells = (row: LedgerRow): string[] => [
  row.cell ?? "—",
  row.run === null ? "—" : String(row.run),
  row.jobId,
  row.preset,
  row.status,
  row.excluded === null ? "yes" : `no: ${row.excluded}`,
  row.clocks.startedAt ?? "—",
  row.clocks.finishedAt ?? "—",
  fixedOrDash(row.clocks.queueToClaimS, 1),
  fixedOrDash(row.clocks.endToEndS === null ? null : row.clocks.endToEndS / 60, 2),
  (row.clocks.stageSumS / 60).toFixed(2),
  fixedOrDash(row.clocks.unaccountedS, 1),
  fallbackFactOf(row.solverConfig),
  row.deliveredObjective === null ? "—" : `[${row.deliveredObjective.join(",")}]`,
];

const tierCell = (row: LedgerRow, tier: number): string => {
  const stage = row.stages.find((candidate) => candidate.tier === tier);
  if (stage === undefined) return "—";
  return `${stage.best ?? "—"}/${stage.bound ?? "—"} ${stage.status} ${stage.stoppedBy ?? "—"}`;
};

const fixedOrDash = (value: number | null, digits: number): string => (value === null ? "—" : value.toFixed(digits));

/** Derived seconds rounded to the millisecond the timestamps carry, so float noise from summing
 *  stage clocks (`68.23235100000001`) never reaches the committed record. */
const toMilliseconds = (seconds: number): number => Math.round(seconds * 1000) / 1000;

const toMillisecondsOrNull = (seconds: number | null): number | null =>
  seconds === null ? null : toMilliseconds(seconds);
