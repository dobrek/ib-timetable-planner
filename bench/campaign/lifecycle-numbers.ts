import { secondsBetween } from "../generation-jobs-report.ts";
import type { ParsedLine, ParsedTelemetry } from "./telemetry-lines.ts";

/**
 * S-308 Phase 3's five production numbers, computed from row clocks and log timestamps — pure, so
 * the arithmetic is tested and the dated block printed for `change.md` is the same block every time.
 *
 * | Number                         | Source                                                          |
 * |--------------------------------|-----------------------------------------------------------------|
 * | cold start                     | `started_at − created_at`, cross-checked against the startup line |
 * | renewal cadence                | gaps between `sleep declined` lines                             |
 * | idle-sleep boundary            | `idle at sleepAfter` / `stopped:` minus the LAST request         |
 * | SIGTERM → `interrupted`        | the shutdown pair, against the drill row's `finished_at`        |
 * | drill duration, stage reached  | the drill's row                                                 |
 *
 * "The last request" is the last thing that renewed the container's activity: a dispatch (the Durable
 * Object logs `started` on every one) or a declined sleep. The sleep clock runs from there, not from
 * the solve's end — S-302 learned that the hard way (30.002 min from the dispatch).
 */
export type JobClocks = {
  readonly jobId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** The ladder position whose checkpoint survived, for a halted job. */
  readonly checkpointPosition: number | null;
  /** How many ladder stages the transcript reached. */
  readonly stagesReached: number;
};

export type LifecycleInput = {
  /** The renewal command's solve: a full ladder longer than `sleepAfter`. */
  readonly renewal: JobClocks;
  /** Container and Durable Object lines from the renewal's dispatch until the container stopped. */
  readonly renewalLines: readonly ParsedTelemetry[];
  readonly drill: JobClocks | null;
  /** The shutdown pair the drill's deploy produced. */
  readonly drillLines: readonly ParsedTelemetry[];
  /** `unaccounted` per counted run, for S-308's follow-up on `OVERHEAD_ALLOWANCE_S`. */
  readonly unaccounted: readonly { readonly jobId: string; readonly seconds: number | null }[];
};

export type LifecycleNumbers = {
  readonly coldStartS: number | null;
  /** The container's own startup line, against the row's `created_at`. */
  readonly coldStartFromLineS: number | null;
  readonly renewalGapsS: readonly number[];
  readonly idleAfterLastRequestS: number | null;
  readonly stoppedAfterLastRequestS: number | null;
  /** What the shutdown line itself reports. */
  readonly terminalWriteS: number | null;
  /** From the SIGTERM-side line to the drill row's `finished_at`. */
  readonly sigtermToFinishedS: number | null;
  readonly drillDurationMin: number | null;
  readonly drillStageReached: number | null;
  readonly drillCheckpointPosition: number | null;
};

export const lifecycleNumbers = (input: LifecycleInput): LifecycleNumbers => {
  const { renewal, renewalLines, drill, drillLines } = input;
  const startup = first(renewalLines, "startup");
  const declined = renewalLines.filter((line) => line.parsed.kind === "do-sleep-declined");
  const idle = first(renewalLines, "do-idle");
  const stopped = first(renewalLines, "do-stopped");
  const lastRequest = lastBefore(renewalLines, idle?.timestamp ?? Number.POSITIVE_INFINITY);
  const asked = first(drillLines, "shutdown-asked");
  const written = first(drillLines, "shutdown-written");
  return {
    coldStartS: roundedSecondsBetween(renewal.createdAt, renewal.startedAt),
    coldStartFromLineS:
      startup === undefined ? null : round((startup.timestamp - Date.parse(renewal.createdAt)) / 1000),
    renewalGapsS: declined
      .slice(1)
      .map((line, index) => round((line.timestamp - (declined[index]?.timestamp ?? line.timestamp)) / 1000)),
    idleAfterLastRequestS: elapsedSince(lastRequest, idle),
    stoppedAfterLastRequestS: elapsedSince(lastRequest, stopped),
    terminalWriteS: written?.parsed.kind === "shutdown-written" ? written.parsed.seconds : null,
    sigtermToFinishedS:
      asked === undefined || drill?.finishedAt == null
        ? null
        : round((Date.parse(drill.finishedAt) - asked.timestamp) / 1000),
    drillDurationMin: drill === null ? null : minutes(roundedSecondsBetween(drill.startedAt, drill.finishedAt)),
    drillStageReached: drill?.stagesReached ?? null,
    drillCheckpointPosition: drill?.checkpointPosition ?? null,
  };
};

/**
 * Why the renewal observation does not prove renewal yet, or nothing. All four are required: a
 * declined sleep DURING the solve, a solve that succeeded, and the idle and stop lines after it.
 */
export const renewalProblems = (input: LifecycleInput): string[] => {
  const { renewal, renewalLines } = input;
  const finishedAt = renewal.finishedAt === null ? Number.POSITIVE_INFINITY : Date.parse(renewal.finishedAt);
  return [
    renewalLines.some((line) => line.parsed.kind === "do-sleep-declined" && line.timestamp <= finishedAt)
      ? null
      : "no `sleep declined` line while the solve ran — renewal is unproven",
    renewal.status === "succeeded" ? null : `the renewal solve ended ${renewal.status}, not succeeded`,
    first(renewalLines, "do-idle") === undefined ? "no `idle at sleepAfter` line yet" : null,
    first(renewalLines, "do-stopped") === undefined ? "no `stopped:` line yet" : null,
  ].filter((problem): problem is string => problem !== null);
};

/** The dated block S-308's `change.md` records — numbers and job ids only. */
export const formatLifecycleBlock = (numbers: LifecycleNumbers, input: LifecycleInput, date: string): string =>
  [
    `**Production lifecycle numbers — recorded ${date}** (renewal job \`${input.renewal.jobId}\`${input.drill === null ? "" : `, drill job \`${input.drill.jobId}\``})`,
    "",
    "| number | value |",
    "| --- | --- |",
    `| cold start (\`started_at − created_at\`) | ${seconds(numbers.coldStartS)} (startup line: ${seconds(numbers.coldStartFromLineS)}) |`,
    `| renewal cadence (gaps between \`sleep declined\`) | ${numbers.renewalGapsS.length === 0 ? "— (fewer than two lines)" : numbers.renewalGapsS.map((gap) => `${gap} s`).join(", ")} |`,
    `| idle-sleep boundary (after the last request) | idle ${seconds(numbers.idleAfterLastRequestS)}, stopped ${seconds(numbers.stoppedAfterLastRequestS)} |`,
    `| SIGTERM → \`interrupted\` | terminal write ${seconds(numbers.terminalWriteS)}; SIGTERM line → \`finished_at\` ${seconds(numbers.sigtermToFinishedS)} |`,
    `| drill duration, stage reached | ${numbers.drillDurationMin === null ? "—" : `${numbers.drillDurationMin} min`}, ${numbers.drillStageReached ?? "—"} stage(s), checkpoint at position ${numbers.drillCheckpointPosition ?? "—"} |`,
    "",
    `Observed \`unaccounted\` per counted run (for \`OVERHEAD_ALLOWANCE_S\`): ${
      input.unaccounted.length === 0
        ? "none yet"
        : input.unaccounted.map((run) => `\`${run.jobId.slice(0, 8)}\` ${seconds(run.seconds)}`).join(", ")
    }`,
  ].join("\n");

// --- helpers --------------------------------------------------------------------------------------

const first = (lines: readonly ParsedTelemetry[], kind: ParsedLine["kind"]): ParsedTelemetry | undefined =>
  lines.find((line) => line.parsed.kind === kind);

/** The last activity renewal before `at`: a dispatch (`started`) or a declined sleep. */
const lastBefore = (lines: readonly ParsedTelemetry[], at: number): ParsedTelemetry | undefined =>
  lines
    .filter(
      (line) => (line.parsed.kind === "do-started" || line.parsed.kind === "do-sleep-declined") && line.timestamp < at,
    )
    .at(-1);

const elapsedSince = (from: ParsedTelemetry | undefined, to: ParsedTelemetry | undefined): number | null =>
  from === undefined || to === undefined ? null : round((to.timestamp - from.timestamp) / 1000);

/** The report's clock (null on a missing or unreadable timestamp), to the tenth of a second. */
const roundedSecondsBetween = (from: string | null, to: string | null): number | null => {
  const elapsed = secondsBetween(from, to);
  return elapsed === null ? null : round(elapsed);
};

const minutes = (value: number | null): number | null => (value === null ? null : Math.round((value / 60) * 100) / 100);

const round = (value: number): number => Math.round(value * 10) / 10;

const seconds = (value: number | null): string => (value === null ? "—" : `${value} s`);
