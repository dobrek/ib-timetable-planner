import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "./journal.ts";
import { appendEntry, openAttempt, parseJournal, readJournal, replay } from "./journal.ts";

/**
 * The journal must survive a closed laptop at any instant: an append is durable before it returns,
 * a write torn by a crash costs only the action it was about to begin, and a trailing intent is
 * reported as pending — never silently dropped and never silently completed.
 */
const directories: string[] = [];
const scratch = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "campaign-journal-"));
  directories.push(directory);
  return join(directory, "journal.jsonl");
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const intent = (seq: number): JournalEntry => ({
  type: "intent",
  seq,
  at: `2026-10-01T10:0${seq}:00.000Z`,
  action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
});

describe("the journal file", () => {
  it("appends one JSON line per entry and reads them back in order", () => {
    const path = scratch();
    appendEntry(path, intent(1));
    appendEntry(path, { type: "resume", at: "2026-10-01T10:05:00.000Z" });

    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    expect(readJournal(path)).toEqual([intent(1), { type: "resume", at: "2026-10-01T10:05:00.000Z" }]);
  });

  it("reads a missing file as an empty journal", () => {
    expect(readJournal(join(tmpdir(), "no-such-campaign", "journal.jsonl"))).toEqual([]);
  });

  it("drops a final line torn by a crash — the action it began never ran", () => {
    const path = scratch();
    writeFileSync(path, `${JSON.stringify(intent(1))}\n{"type":"outcome","seq":1,"at":"2026-`);

    expect(readJournal(path)).toEqual([intent(1)]);
  });

  it("refuses a corrupt line anywhere else", () => {
    expect(() => parseJournal(`not json\n${JSON.stringify(intent(1))}\n`)).toThrow(/journal line 1 is unreadable/);
  });
});

describe("replay", () => {
  it("reports a trailing intent with no outcome as pending, rather than completing or dropping it", () => {
    const state = replay([intent(1)]);

    expect(state.pending).toEqual({
      seq: 1,
      at: "2026-10-01T10:01:00.000Z",
      action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
    });
    expect(state.attempts).toEqual([]);
  });

  it("closes the intent its outcome names, and records the run it dispatched", () => {
    const state = replay([
      intent(1),
      {
        type: "outcome",
        seq: 1,
        at: "2026-10-01T10:02:00.000Z",
        result: { kind: "dispatch", jobId: "job-1", proposalPlanId: "proposal-1", liveVersion: "v@100", adopted: true },
      },
    ]);

    expect(state.pending).toBeNull();
    expect(openAttempt(state)).toMatchObject({
      cell: "A",
      slot: 1,
      jobId: "job-1",
      dispatchedAt: "2026-10-01T10:01:00.000Z",
    });
  });

  it("ignores an outcome for an intent that is not the pending one", () => {
    const state = replay([intent(2), { type: "outcome", seq: 1, at: "x", result: { kind: "park" } }]);

    expect(state.pending?.seq).toBe(2);
  });

  it("remembers the first counted host, and a recorded observation about secret changes", () => {
    const state = replay([
      intent(1),
      {
        type: "outcome",
        seq: 1,
        at: "t1",
        result: { kind: "dispatch", jobId: "j", proposalPlanId: null, liveVersion: "v", adopted: false },
      },
      { type: "intent", seq: 2, at: "t2", action: { kind: "record", jobId: "j" } },
      {
        type: "outcome",
        seq: 2,
        at: "t3",
        result: { kind: "record", excluded: null, host: { machine: "x86_64", cpuCount: 4 } },
      },
      { type: "observation", at: "t4", key: "secret-change-during-solve", disturbed: false },
    ]);

    expect(state.firstHost).toEqual({ machine: "x86_64", cpuCount: 4 });
    expect(state.secretChangeDisturbsSolve).toBe(false);
  });
});
