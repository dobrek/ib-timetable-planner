/**
 * The analyzer's machine-readable output: one `@campaign {json}` line per answer, printed beside the
 * human report on stdout.
 *
 * `pnpm analyze:jobs` runs under vitest, so its stdout also carries the reporter's own lines. A fixed
 * prefix lets the campaign runner — which invokes the analyzer as a subprocess — pick out the answers
 * without parsing anything else, and lets a human see at a glance which lines are for the program.
 *
 * Ids and numbers only, like everything else the campaign writes down.
 *
 * Dependency-free for the reason `campaign-cell.ts` gives: the runner loads it under Node's type
 * stripping.
 */
export const ANALYZER_LINE_PREFIX = "@campaign ";

export type ActiveJobEntry = {
  readonly jobId: string;
  readonly planId: string;
  readonly status: "queued" | "running";
  /** The clock the staleness verdict was read from: `heartbeat_at` when running, `created_at` when queued. */
  readonly since: string | null;
};

export type AnalyzerLine =
  | { readonly kind: "ledger"; readonly path: string; readonly rows: number; readonly jobIds: readonly string[] }
  | {
      readonly kind: "active-jobs";
      readonly blocking: readonly ActiveJobEntry[];
      readonly stale: readonly ActiveJobEntry[];
    }
  | { readonly kind: "job-id"; readonly prefix: string; readonly jobId: string }
  | { readonly kind: "remaining-hours"; readonly planId: string; readonly unplacedHours: number };

export const formatAnalyzerLine = (line: AnalyzerLine): string => `${ANALYZER_LINE_PREFIX}${JSON.stringify(line)}`;

/**
 * Every answer in a captured stdout, in order. A line that carries the prefix but not a JSON object
 * with a known `kind` is an error rather than a skip: the prefix is a promise, and a runner that
 * silently dropped a garbled answer would act on the absence of one.
 */
export const parseAnalyzerLines = (stdout: string): AnalyzerLine[] =>
  stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith(ANALYZER_LINE_PREFIX))
    .map((line) => parseLine(line.slice(ANALYZER_LINE_PREFIX.length)));

const KINDS: readonly string[] = ["ledger", "active-jobs", "job-id", "remaining-hours"];

const parseLine = (json: string): AnalyzerLine => {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || !("kind" in value) || !KINDS.includes(String(value.kind))) {
    throw new Error(`Not an analyzer answer: ${json}`);
  }
  return value as AnalyzerLine;
};
