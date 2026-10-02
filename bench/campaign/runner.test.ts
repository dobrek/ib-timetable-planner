import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "./journal.ts";
import { readJournal, replay } from "./journal.ts";
import { nextStep } from "./next-step.ts";
import type { Context, JobView } from "./runner.ts";
import { isAdoptable, missingFrom, perform, runLoop } from "./runner.ts";

/**
 * The write-ahead rule at the one place every intent is opened: replay keeps a single pending intent,
 * so a new intent on top of an open one would erase it — and with it the only trace of a dispatch
 * whose job may already exist. A graceful stop is the path that used to do exactly that.
 */
const directories: string[] = [];
const scratchJournal = (entries: readonly JournalEntry[]): string => {
  const directory = mkdtempSync(join(tmpdir(), "campaign-runner-"));
  directories.push(directory);
  const path = join(directory, "journal.jsonl");
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return path;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const AT = "2026-10-01T08:00:00.000Z";
const TUNING = { workers: 4, stageBudgetS: 120, modeABudgetS: 300 };

/** Set up, Cell A applied (so an override is live), then a dispatch whose outcome never arrived. */
const OPEN_DISPATCH: readonly JournalEntry[] = [
  {
    type: "intent",
    seq: 1,
    at: AT,
    action: { kind: "setup", target: "production", sourcePlanId: "source", name: "Calibration — test" },
  },
  { type: "outcome", seq: 1, at: AT, result: { kind: "setup", campaignPlanId: "campaign", remainingHours: 40 } },
  { type: "intent", seq: 2, at: AT, action: { kind: "apply-cell", cell: "A", tuning: TUNING } },
  { type: "outcome", seq: 2, at: AT, result: { kind: "apply-cell" } },
  { type: "intent", seq: 3, at: AT, action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 } },
];

/** Only the journal path and the stop signal are reachable on the paths under test. */
const contextFor = (journalPath: string, stop: AbortSignal): Context =>
  ({
    config: { target: "production", stateDir: "", journalPath, ledgerPath: "", ledgerCopyPath: "" },
    stop,
  }) as unknown as Context;

describe("perform", () => {
  it("refuses to open an intent on top of an open one", async () => {
    const journalPath = scratchJournal(OPEN_DISPATCH);
    const state = replay(readJournal(journalPath));

    await expect(
      perform(contextFor(journalPath, new AbortController().signal), state, { kind: "park" }, null),
    ).rejects.toThrow(/still open/);
    expect(readJournal(journalPath)).toHaveLength(OPEN_DISPATCH.length);
  });
});

describe("a cell change", () => {
  it("waits for someone else's solve even after the drill showed secret changes are harmless", async () => {
    const journalPath = scratchJournal([
      ...OPEN_DISPATCH.slice(0, 2),
      { type: "observation", at: AT, key: "secret-change-during-solve", disturbed: false },
    ]);
    const state = replay(readJournal(journalPath));
    const stopped = new AbortController();
    stopped.abort();
    const applyCell = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = {
      ...contextFor(journalPath, stopped.signal),
      analyzer: { activeJobs: () => Promise.resolve({ blocking: [{ jobId: "authors-job" }], stale: [] }) },
      controller: { applyCell },
    } as unknown as Context;

    const settled = await perform(context, state, { kind: "apply-cell", cell: "A", tuning: TUNING }, null);

    expect(settled).toBe(false);
    expect(applyCell).not.toHaveBeenCalled();
  });
});

describe("a graceful stop", () => {
  it("leaves the override live rather than parking over an open dispatch", async () => {
    const journalPath = scratchJournal(OPEN_DISPATCH);
    const stopped = new AbortController();
    stopped.abort();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));

    const code = await runLoop(contextFor(journalPath, stopped.signal), nextStep, "done");

    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/STILL LIVE/);
    expect(readFileSync(journalPath, "utf8")).not.toMatch(/"kind":"park"/);
    expect(replay(readJournal(journalPath)).pending?.action.kind).toBe("dispatch");
  });
});

describe("isAdoptable", () => {
  const intentAt = "2026-10-01T09:00:00.000Z";
  const view = (overrides: Partial<JobView> = {}): JobView => ({
    jobId: "found-job",
    status: "running",
    createdAt: "2026-10-01T09:00:05.000Z",
    delivered: false,
    proposalPlanId: "proposal",
    checkpointStageIndex: null,
    ...overrides,
  });
  const state = replay(OPEN_DISPATCH);

  it("adopts a job the journal has never seen, created after the intent", () => {
    expect(isAdoptable(state, view(), intentAt)).toBe(true);
  });

  it("tolerates a server clock a little behind the laptop's", () => {
    expect(isAdoptable(state, view({ createdAt: "2026-10-01T08:59:00.000Z" }), intentAt)).toBe(true);
  });

  it("never adopts a job created well before the intent — an orphan, or someone else's solve", () => {
    expect(isAdoptable(state, view({ createdAt: "2026-10-01T08:30:00.000Z" }), intentAt)).toBe(false);
  });

  it("never adopts a job the journal already holds, so one solve is never filed twice", () => {
    const recorded = replay([
      ...OPEN_DISPATCH,
      {
        type: "outcome",
        seq: 3,
        at: AT,
        result: { kind: "dispatch", jobId: "found-job", proposalPlanId: "p", liveVersion: "v1@100", adopted: false },
      },
    ]);

    expect(isAdoptable(recorded, view(), intentAt)).toBe(false);
  });
});

describe("missingFrom — the cleanup gate's question", () => {
  const ledgerAt = (rows: readonly { jobId: string }[] | null): string => {
    const path = join(scratchJournal([]), "..", "ledger.json");
    if (rows !== null) writeFileSync(path, JSON.stringify({ version: 1, rows }));
    return path;
  };

  it("reports every dispatched job missing when the copy was never made", () => {
    expect(missingFrom(ledgerAt(null), ["a", "b"])).toEqual(["a", "b"]);
  });

  it("names exactly the dispatched jobs a ledger lacks", () => {
    expect(missingFrom(ledgerAt([{ jobId: "a" }]), ["a", "b"])).toEqual(["b"]);
    expect(missingFrom(ledgerAt([{ jobId: "a" }, { jobId: "b" }]), ["a", "b"])).toEqual([]);
  });
});
