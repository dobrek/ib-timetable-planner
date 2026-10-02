import type { ActiveJobEntry, AnalyzerLine } from "../analyzer-lines.ts";
import type { WorkerVersions } from "../campaign-ledger.ts";
import { parseAnalyzerLines } from "../analyzer-lines.ts";
import { childEnv, spawnChild } from "./process-lifetime.ts";

/**
 * The runner's reads of `generation_jobs`, through `pnpm analyze:jobs` as a subprocess.
 *
 * Why a subprocess: the analyzer needs the entity's readers (`@/entities/timetable`), which resolve
 * only under vitest's alias, while the runner runs under bare Node. Keeping every row read in the
 * analyzer also keeps ONE extractor of record — the runner never re-declares a row shape.
 *
 * **The service-role key goes to the subprocess only.** It arrives in the runner's environment under
 * a name nothing else reads (`ANALYZER_SERVICE_ROLE_KEY`) and is handed to the analyzer as the
 * `SUPABASE_*` pair it expects; it is never written to `.env.test.local`, `.env.local` or `.dev.vars`,
 * because those feed processes — the integration lane above all — that would write with it.
 */
export type AnalyzerAccess = {
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  /** The hosted project needs the analyzer's explicit override; the local stack does not. */
  readonly allowRemote: boolean;
};

export type AnalyzerClient = {
  activeJobs(): Promise<{ blocking: readonly ActiveJobEntry[]; stale: readonly ActiveJobEntry[] }>;
  /** The hours a Generate would hand the solver and, given a name, whether the plan bears it. */
  remainingHours(planId: string, expectedName?: string): Promise<PlanFacts>;
  /** Merge these jobs into the ledger file under the given validity rules: the ledger's row count, and
   *  the tables (ledger, matrix) the analyzer printed beside it. */
  extractLedger(request: LedgerRequest): Promise<{ rows: number; report: string }>;
};

export type PlanFacts = { readonly unplacedHours: number; readonly nameMatches: boolean | null };

export type LedgerRequest = {
  readonly ledgerPath: string;
  readonly jobIds: readonly string[];
  /** Every dispatched job's cell key, so a wrong-cell run is excluded by the ledger itself. */
  readonly cells: ReadonlyMap<string, string>;
  readonly expectedHost: string | null;
  /** Every dispatched job's Worker version at dispatch and at terminal, so a stray deploy outlives the journal. */
  readonly versions: ReadonlyMap<string, WorkerVersions>;
};

export const createAnalyzerClient = (access: AnalyzerAccess): AnalyzerClient => {
  const ask = async (env: Record<string, string>): Promise<{ lines: AnalyzerLine[]; output: string }> => {
    const { code, output } = await runPnpm(["analyze:jobs"], { ...analyzerEnv(access), ...env });
    if (code !== 0) throw new Error(`pnpm analyze:jobs exited ${code}:\n${output.split("\n").slice(-25).join("\n")}`);
    return { lines: parseAnalyzerLines(output), output };
  };

  return {
    activeJobs: async () => {
      const answer = only((await ask({ ANALYZE_ACTIVE: "1" })).lines, "active-jobs");
      return { blocking: answer.blocking, stale: answer.stale };
    },
    remainingHours: async (planId, expectedName = "") => {
      const answer = only(
        (await ask({ ANALYZE_REMAINING_HOURS: planId, ANALYZE_EXPECT_PLAN_NAME: expectedName })).lines,
        "remaining-hours",
      );
      return { unplacedHours: answer.unplacedHours, nameMatches: answer.nameMatches };
    },
    extractLedger: async ({ ledgerPath, jobIds, cells, expectedHost, versions }) => {
      const { lines, output } = await ask({
        ANALYZE_LEDGER: ledgerPath,
        ANALYZE_JOBS: jobIds.join(","),
        ANALYZE_CELLS: [...cells].map(([jobId, cell]) => `${jobId}:${cell}`).join(","),
        ANALYZE_REQUIRE_SOLVER_CONFIG: "1",
        ANALYZE_EXPECT_HOST: expectedHost ?? "",
        ANALYZE_VERSIONS: JSON.stringify(Object.fromEntries(versions)),
      });
      return { rows: only(lines, "ledger").rows, report: humanReport(output) };
    },
  };
};

/**
 * The analyzer's whole environment: the runner's own, minus anything Supabase-shaped it may have
 * inherited and the campaign's own credentials, plus the pair this access names. Every `ANALYZE_*`
 * switch is cleared too, so a stray export in the operator's shell cannot change which question is
 * asked.
 */
export const analyzerEnv = (access: AnalyzerAccess): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(childEnv()).filter(([key]) => !/^(SUPABASE_|ANALYZE_|ANALYZER_|CAMPAIGN_|LOCAL_SOLVER_)/.test(key)),
  ),
  SUPABASE_URL: access.supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: access.serviceRoleKey,
  ...(access.allowRemote ? { ANALYZE_ALLOW_REMOTE: "1" } : {}),
});

const only = <K extends AnalyzerLine["kind"]>(
  lines: readonly AnalyzerLine[],
  kind: K,
): Extract<AnalyzerLine, { kind: K }> => {
  const matching = lines.filter((line): line is Extract<AnalyzerLine, { kind: K }> => line.kind === kind);
  if (matching.length !== 1) throw new Error(`expected one ${kind} answer from the analyzer, got ${matching.length}`);
  return matching[0];
};

/** The analyzer's own tables, from its first heading to its answer line — without the reporter around them. */
const humanReport = (output: string): string => {
  const start = output.indexOf("**Runs**");
  const end = output.indexOf("@campaign ");
  return start === -1 ? "" : output.slice(start, end === -1 ? undefined : end).trimEnd();
};

/** `pnpm <args>` with exactly `env` (not merged again), stdout and stderr captured together. */
const runPnpm = (args: readonly string[], env: Record<string, string>): Promise<{ code: number; output: string }> =>
  new Promise((resolve, reject) => {
    // A ledger extraction scores every delivered board; vitest.analyze caps each mode at 120 s.
    const child = spawnChild("pnpm", args, { env, stdio: ["ignore", "pipe", "pipe"], timeoutMs: 10 * 60_000 });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
