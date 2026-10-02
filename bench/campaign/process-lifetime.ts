/* eslint-disable no-console -- the console IS the runner's operator interface (bench precedent). */
import { spawn } from "node:child_process";
import type { ChildProcess, StdioOptions } from "node:child_process";

/**
 * The runner's process lifetime: how it hears a stop, and the children it starts.
 *
 * Ctrl-C signals the terminal's whole foreground process group, and `mise run` forwards the same
 * SIGINT to its task on top of that, so one keypress reaches the runner twice, milliseconds apart,
 * and reaches every child that shares its group. Two rules follow:
 *
 *   - a repeat signal inside `REPEAT_SIGNAL_GRACE_MS` is the same keypress, not a second Ctrl-C;
 *   - every child runs detached, in its own process group, so it finishes the call in hand (a ledger
 *     write, a `wrangler secret bulk`) and the runner alone decides what a stop means. A hard exit
 *     kills whatever is still running.
 *
 * Runs under bare Node (type stripping) — see `definition.ts` for the import rules that implies.
 */

export const REPEAT_SIGNAL_GRACE_MS = 2_000;

/**
 * The runner's own credentials. It reads them from its environment; no child inherits them — the
 * analyzer is handed its key explicitly, renamed, and the local solver its password the same way.
 */
const RUNNER_SECRETS: readonly string[] = [
  "ANALYZER_SERVICE_ROLE_KEY",
  "CAMPAIGN_PASSWORD",
  "CLOUDFLARE_OBSERVABILITY_TOKEN",
  "LOCAL_SOLVER_MACHINE_PASSWORD",
];

/** First Ctrl-C (or SIGTERM): finish the step, then stop. A later one: exit at once, parking nothing. */
export const stopSignal = (): AbortSignal => {
  const controller = new AbortController();
  let firstAt = 0;
  const onSignal = (): void => {
    if (!controller.signal.aborted) {
      firstAt = Date.now();
      console.log("\nstopping after this step (Ctrl-C again to exit at once)");
      controller.abort();
      return;
    }
    if (Date.now() - firstAt < REPEAT_SIGNAL_GRACE_MS) return;
    console.log("\nexiting now — nothing parked; `status` shows any live override");
    killChildren();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return controller.signal;
};

/** `process.env` without the runner's own credentials: what a child inherits unless handed more. */
export const childEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !RUNNER_SECRETS.includes(entry[0]),
    ),
  );

/**
 * `spawn`, detached into its own process group and tracked until it exits. A child still running after
 * `timeoutMs` has its group stopped, so a hung `wrangler` fails the step instead of hanging the runner.
 */
export const spawnChild = (
  command: string,
  args: readonly string[],
  {
    timeoutMs,
    ...options
  }: { readonly env?: NodeJS.ProcessEnv; readonly stdio: StdioOptions; readonly timeoutMs: number },
): ChildProcess => {
  const child = spawn(command, [...args], { env: childEnv(), ...options, detached: true });
  children.add(child);
  const timer = setTimeout(() => {
    console.error(`\n${command} ${args.join(" ")} still running after ${Math.round(timeoutMs / 1000)} s — stopping it`);
    stopGroup(child);
  }, timeoutMs);
  const settle = (): void => {
    clearTimeout(timer);
    children.delete(child);
  };
  child.on("exit", settle);
  child.on("error", settle);
  return child;
};

/** A command's stdout. A non-zero exit rejects with its stderr. Git, docker and wrangler calls: minutes. */
export const run = (command: string, args: readonly string[], timeoutMs = 5 * 60_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawnChild(command, args, { stdio: ["ignore", "pipe", "pipe"], timeoutMs });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else
        reject(
          new Error(
            `${exitDescription(command, args, code, signal)}: ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
    });
  });

/** A long build or deploy, its output shown as it happens — an image build and push included. */
export const stream = (command: string, args: readonly string[], timeoutMs = 45 * 60_000): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawnChild(command, args, { stdio: ["ignore", "inherit", "inherit"], timeoutMs });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(exitDescription(command, args, code, signal)));
    });
  });

// --- helpers --------------------------------------------------------------------------------------

const children = new Set<ChildProcess>();

/** SIGTERM to each live child's whole group. */
const killChildren = (): void => {
  for (const child of children) stopGroup(child);
};

/** SIGTERM to a child's whole group (`pnpm exec` runs the real command as a grandchild); gone is fine. */
const stopGroup = (child: ChildProcess): void => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // already exited
  }
};

const exitDescription = (
  command: string,
  args: readonly string[],
  code: number | null,
  signal: NodeJS.Signals | null,
): string => `${command} ${args.join(" ")} exited ${code ?? signal ?? "?"}`;
