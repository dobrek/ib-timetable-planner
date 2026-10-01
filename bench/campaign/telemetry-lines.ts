/**
 * The production log lines the lifecycle commands compute with, parsed into facts — pure, so every
 * number S-308's Phase 3 records is tested against lines captured from the live account.
 *
 * Two sources, told apart by where they land (the spike, 2026-10-01):
 *
 * - **container** stdout — the `containers` dataset, `$metadata.type = cf-container`. Python logging
 *   prefixes each line (`2026-10-01 12:01:53,004 INFO cpsat_service.app: …`), so the parsers match the
 *   text after the logger name, never the prefix.
 * - **Durable Object** lines — `cloudflare-workers`, `$workers.executionModel = durableObject`, always
 *   `[solver-container] …` (`src/solver-container.ts`).
 *
 * A line this file does not know is `null`, not an error: the containers dataset also carries
 * uvicorn's and httpx's own lines, and those are noise here.
 *
 * Dependency-free for the runner's Node type stripping (see `definition.ts`).
 */
export type TelemetryLine = {
  /** Epoch milliseconds — the event's own `timestamp`, not when it became queryable. */
  readonly timestamp: number;
  readonly message: string;
};

export type ParsedLine =
  /** `solver service starting:` — the container's cold start, and the values it booted with. */
  | { readonly kind: "startup"; readonly values: StartupValues }
  | { readonly kind: "job-solving"; readonly jobId: string; readonly workers: number; readonly preset: string }
  | { readonly kind: "job-succeeded"; readonly jobId: string; readonly placements: number }
  /** The SIGTERM half of the shutdown pair: how many solves were latched. */
  | { readonly kind: "shutdown-asked"; readonly solves: number }
  /** …and the other half: how long they took to write their terminal rows. */
  | { readonly kind: "shutdown-written"; readonly seconds: number }
  | { readonly kind: "shutdown-idle" }
  | { readonly kind: "do-started" }
  | { readonly kind: "do-sleep-declined"; readonly solves: number }
  | { readonly kind: "do-idle" }
  | { readonly kind: "do-stopped"; readonly exitCode: string; readonly reason: string }
  | { readonly kind: "do-stop-if-idle"; readonly outcome: string };

export type ParsedTelemetry = TelemetryLine & { readonly parsed: ParsedLine };

/** The startup line's `key=value` pairs. A key the line did not carry is absent, not empty. */
export type StartupValues = Readonly<Partial<Record<string, string>>>;

export const parseLine = (message: string): ParsedLine | null =>
  PARSERS.map(([pattern, build]) => {
    const match = pattern.exec(message);
    return match === null ? null : build(match);
  }).find((parsed) => parsed !== null) ?? null;

/** Every line a parser recognises, in time order. */
export const parseLines = (lines: readonly TelemetryLine[]): ParsedTelemetry[] =>
  lines
    .flatMap((line) => {
      const parsed = parseLine(line.message);
      return parsed === null ? [] : [{ ...line, parsed }];
    })
    .sort((a, b) => a.timestamp - b.timestamp);

/** `workers=4 … stage_budget_s=120` as numbers; null where the line said something else (`<engine-default>`). */
export const startupTuning = (
  values: StartupValues,
): {
  workers: number | null;
  stageBudgetS: number | null;
  modeABudgetS: number | null;
  stageTargets: string | null;
} => ({
  workers: numberOrNull(values.workers),
  stageBudgetS: numberOrNull(values.stage_budget_s),
  modeABudgetS: numberOrNull(values.mode_a_budget_s),
  stageTargets: values.stage_targets ?? null,
});

// --- parsers --------------------------------------------------------------------------------------

const JOB_ID = "([0-9a-f-]{36})";

const PARSERS: readonly (readonly [RegExp, (match: RegExpExecArray) => ParsedLine])[] = [
  [/solver service starting: (.*)$/, (match) => ({ kind: "startup", values: keyValues(match[1]) })],
  [
    new RegExp(`job ${JOB_ID} solving with (\\d+) workers under the (\\S+) policy`),
    (match) => ({ kind: "job-solving", jobId: match[1], workers: Number(match[2]), preset: match[3] }),
  ],
  [
    new RegExp(`job ${JOB_ID} succeeded with (\\d+) placements`),
    (match) => ({ kind: "job-succeeded", jobId: match[1], placements: Number(match[2]) }),
  ],
  [/shutdown: asked (\d+) solve\(s\) to stop/, (match) => ({ kind: "shutdown-asked", solves: Number(match[1]) })],
  [
    /shutdown: every solve wrote its terminal row in ([\d.]+)s/,
    (match) => ({ kind: "shutdown-written", seconds: Number(match[1]) }),
  ],
  [/shutdown: no solve in flight/, () => ({ kind: "shutdown-idle" })],
  [/\[solver-container\] started$/, () => ({ kind: "do-started" })],
  [
    /\[solver-container\] sleep declined: (\d+) solve\(s\) in flight/,
    (match) => ({ kind: "do-sleep-declined", solves: Number(match[1]) }),
  ],
  [/\[solver-container\] idle at sleepAfter/, () => ({ kind: "do-idle" })],
  [
    /\[solver-container\] stopped: exitCode=(\S*) reason=(.*)$/,
    (match) => ({ kind: "do-stopped", exitCode: match[1], reason: match[2].trim() }),
  ],
  [/\[solver-container\] stop-if-idle: (\S+)/, (match) => ({ kind: "do-stop-if-idle", outcome: match[1] })],
];

/** `a=1 b=<none> c=x` → `{ a: "1", b: "<none>", c: "x" }`. Values carry no spaces in the startup line. */
const keyValues = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split("="))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0] !== ""),
  );

const numberOrNull = (raw: string | undefined): number | null => {
  const value = Number(raw);
  return raw === undefined || raw === "" || Number.isNaN(value) ? null : value;
};
