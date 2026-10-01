import { describe, expect, it } from "vitest";
import { formatLifecycleBlock, lifecycleNumbers, renewalProblems } from "./lifecycle-numbers.ts";
import type { JobClocks, LifecycleInput } from "./lifecycle-numbers.ts";
import type { ParsedLine, ParsedTelemetry } from "./telemetry-lines.ts";

/** The five numbers are arithmetic on timestamps; these pin the arithmetic, above all which clock each runs from. */
const T0 = Date.parse("2026-10-02T09:00:00.000Z");
const at = (seconds: number): number => T0 + seconds * 1000;
const iso = (seconds: number): string => new Date(at(seconds)).toISOString();
const line = (seconds: number, parsed: ParsedLine): ParsedTelemetry => ({
  timestamp: at(seconds),
  message: "",
  parsed,
});

const renewal: JobClocks = {
  jobId: "aaaaaaaa-0000-4000-8000-000000000001",
  status: "succeeded",
  createdAt: iso(0),
  startedAt: iso(42),
  finishedAt: iso(1000),
  checkpointPosition: null,
  stagesReached: 10,
};

const drill: JobClocks = {
  jobId: "dddddddd-0000-4000-8000-000000000001",
  status: "interrupted",
  createdAt: iso(-5000),
  startedAt: iso(-4960),
  finishedAt: iso(-3700),
  checkpointPosition: 5,
  stagesReached: 6,
};

const input = (overrides: Partial<LifecycleInput> = {}): LifecycleInput => ({
  renewal,
  renewalLines: [
    line(0.5, { kind: "do-started" }),
    line(40, { kind: "startup", values: {} }),
    line(600, { kind: "do-sleep-declined", solves: 1 }),
    line(1200, { kind: "do-sleep-declined", solves: 1 }),
    line(1800, { kind: "do-idle" }),
    line(1803, { kind: "do-stopped", exitCode: "0", reason: "exit" }),
  ],
  drill,
  drillLines: [
    line(-3706, { kind: "shutdown-asked", solves: 1 }),
    line(-3702, { kind: "shutdown-written", seconds: 4.1 }),
  ],
  unaccounted: [{ jobId: renewal.jobId, seconds: 12.3 }],
  ...overrides,
});

describe("lifecycleNumbers", () => {
  it("computes the cold start from the row, and cross-checks it against the startup line", () => {
    const numbers = lifecycleNumbers(input());

    expect(numbers.coldStartS).toBe(42);
    expect(numbers.coldStartFromLineS).toBe(40);
  });

  it("measures renewal cadence as the gaps between declined sleeps", () => {
    expect(lifecycleNumbers(input()).renewalGapsS).toEqual([600]);
  });

  it("times the idle stop from the LAST request — the last declined sleep — not from the solve's end", () => {
    const numbers = lifecycleNumbers(input());

    expect(numbers.idleAfterLastRequestS).toBe(600);
    expect(numbers.stoppedAfterLastRequestS).toBe(603);
  });

  it("falls back to the dispatch as the last request when no sleep was declined", () => {
    const numbers = lifecycleNumbers(
      input({
        renewalLines: [
          line(0.5, { kind: "do-started" }),
          line(1800.5, { kind: "do-idle" }),
          line(1801, { kind: "do-stopped", exitCode: "0", reason: "exit" }),
        ],
      }),
    );

    expect(numbers.idleAfterLastRequestS).toBe(1800);
  });

  it("reads SIGTERM → interrupted from the shutdown pair and the drill row", () => {
    const numbers = lifecycleNumbers(input());

    expect(numbers.terminalWriteS).toBe(4.1);
    expect(numbers.sigtermToFinishedS).toBe(6);
    expect(numbers.drillDurationMin).toBe(21);
    expect(numbers.drillStageReached).toBe(6);
    expect(numbers.drillCheckpointPosition).toBe(5);
  });

  it("leaves what it cannot know as null rather than guessing", () => {
    const numbers = lifecycleNumbers(input({ drill: null, drillLines: [], renewalLines: [] }));

    expect(numbers).toMatchObject({
      coldStartFromLineS: null,
      renewalGapsS: [],
      idleAfterLastRequestS: null,
      sigtermToFinishedS: null,
      drillDurationMin: null,
    });
  });
});

describe("renewalProblems", () => {
  it("accepts a declined sleep during the solve, a succeeded row, and idle + stopped after", () => {
    expect(renewalProblems(input())).toEqual([]);
  });

  it("names every missing proof", () => {
    const problems = renewalProblems(
      input({ renewal: { ...renewal, status: "interrupted" }, renewalLines: [line(0.5, { kind: "do-started" })] }),
    );

    expect(problems).toEqual([
      "no `sleep declined` line while the solve ran — renewal is unproven",
      "the renewal solve ended interrupted, not succeeded",
      "no `idle at sleepAfter` line yet",
      "no `stopped:` line yet",
    ]);
  });

  it("does not count a declined sleep after the solve ended", () => {
    const late = input({
      renewalLines: [
        line(1500, { kind: "do-sleep-declined", solves: 0 }),
        line(1800, { kind: "do-idle" }),
        line(1801, { kind: "do-stopped", exitCode: "0", reason: "exit" }),
      ],
    });

    expect(renewalProblems(late)).toEqual(["no `sleep declined` line while the solve ran — renewal is unproven"]);
  });
});

describe("formatLifecycleBlock", () => {
  it("prints a dated block with job ids and numbers only", () => {
    const block = formatLifecycleBlock(lifecycleNumbers(input()), input(), "2026-10-02");

    expect(block).toContain("recorded 2026-10-02");
    expect(block).toContain("| cold start (`started_at − created_at`) | 42 s (startup line: 40 s) |");
    expect(block).toContain("idle 600 s, stopped 603 s");
    expect(block).toContain("terminal write 4.1 s; SIGTERM line → `finished_at` 6 s");
    expect(block).toContain("`aaaaaaaa` 12.3 s");
  });
});
