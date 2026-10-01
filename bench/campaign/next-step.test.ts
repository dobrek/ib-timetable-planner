import { describe, expect, it } from "vitest";
import type { ActionResult, JournalAction, JournalEntry } from "./journal.ts";
import { replay } from "./journal.ts";
import { cleanupStep, gridComplete, nextStep } from "./next-step.ts";

/**
 * The runner's every decision is `nextStep(replay(journal))`, so these tests drive it through journals:
 * what the runner does next is pinned for each state the campaign can be in, including both failure
 * branches, the Cell D pause and the cleanup order.
 */
type Pair = readonly [JournalAction, ActionResult];

/** `Array.isArray` does not narrow a readonly tuple out of a union, so the test asks this instead. */
const isPair = (item: Pair | JournalEntry): item is Pair => Array.isArray(item);

/** Intent + outcome per pair, numbered and timed in order; other entries pass through. */
const journalOf = (...items: readonly (Pair | JournalEntry)[]): JournalEntry[] =>
  items.flatMap((item, index) => {
    const at = new Date(Date.UTC(2026, 9, 1, 8, index)).toISOString();
    if (!isPair(item)) return [{ ...item, at }];
    const [action, result] = item;
    return [
      { type: "intent", seq: index + 1, at, action },
      { type: "outcome", seq: index + 1, at, result },
    ];
  });

const SETUP: Pair = [
  { kind: "setup", target: "production", sourcePlanId: "source", name: "Calibration — test" },
  { kind: "setup", campaignPlanId: "campaign", remainingHours: 40 },
];

const A = { workers: 4, stageBudgetS: 120, modeABudgetS: 300 };
const B = { workers: 4, stageBudgetS: 60, modeABudgetS: 300 };
const C = { workers: 4, stageBudgetS: 240, modeABudgetS: 300 };
const D = { workers: 8, stageBudgetS: 120, modeABudgetS: 300 };

const apply = (cell: "A" | "B" | "C" | "D", tuning: typeof A): Pair => [
  { kind: "apply-cell", cell, tuning },
  { kind: "apply-cell" },
];
const STOP: Pair = [{ kind: "stop-container" }, { kind: "stop-container", outcome: "stop" }];
const STOPPED: Pair = [{ kind: "await-stopped" }, { kind: "await-stopped" }];
const PARK: Pair = [{ kind: "park" }, { kind: "park" }];

/** One whole run: dispatch, terminal, delivery, ledger verdict. */
const run = (
  cell: "A" | "B" | "C" | "D" | "main",
  slot: number,
  jobId: string,
  { attempt = 1, excluded = null }: { attempt?: number; excluded?: string | null } = {},
): Pair[] => [
  [
    { kind: "dispatch", cell, slot, attempt },
    { kind: "dispatch", jobId, proposalPlanId: `proposal-${jobId}`, liveVersion: "v1@100", adopted: false },
  ],
  [
    { kind: "await-terminal", jobId },
    { kind: "await-terminal", status: excluded === null ? "succeeded" : "failed", liveVersion: "v1@100" },
  ],
  [
    { kind: "deliver", jobId, proposalPlanId: `proposal-${jobId}` },
    { kind: "deliver", delivered: excluded === null, status: "succeeded" },
  ],
  [
    { kind: "record", jobId },
    { kind: "record", excluded, host: { machine: "x86_64", cpuCount: 4 } },
  ],
];

/** A cell applied, cold-started and run three times. */
const cell = (key: "A" | "B" | "C" | "D", tuning: typeof A): (Pair | JournalEntry)[] => [
  apply(key, tuning),
  STOP,
  STOPPED,
  ...run(key, 1, `${key}1`),
  ...run(key, 2, `${key}2`),
  ...run(key, 3, `${key}3`),
];

const next = (...items: readonly (Pair | JournalEntry)[]) => nextStep(replay(journalOf(...items)));

const action = (journalAction: JournalAction) => ({ kind: "act", action: journalAction, reconcile: null });

describe("nextStep — the cell sequence", () => {
  it("asks for setup on an empty journal", () => {
    expect(next()).toEqual({ kind: "needs-setup" });
  });

  it("applies the first cell, then stops the container, then waits for it to stop, then dispatches", () => {
    expect(next(SETUP)).toEqual(action({ kind: "apply-cell", cell: "A", tuning: A }));
    expect(next(SETUP, apply("A", A))).toEqual(action({ kind: "stop-container" }));
    expect(next(SETUP, apply("A", A), STOP)).toEqual(action({ kind: "await-stopped" }));
    expect(next(SETUP, apply("A", A), STOP, STOPPED)).toEqual(
      action({ kind: "dispatch", cell: "A", slot: 1, attempt: 1 }),
    );
  });

  it("finishes a run — wait, deliver, record — before moving on", () => {
    const [dispatched, terminal, delivered] = run("A", 1, "A1");
    const base = [SETUP, apply("A", A), STOP, STOPPED] as const;

    expect(next(...base, dispatched)).toEqual(action({ kind: "await-terminal", jobId: "A1" }));
    expect(next(...base, dispatched, terminal)).toEqual(
      action({ kind: "deliver", jobId: "A1", proposalPlanId: "proposal-A1" }),
    );
    expect(next(...base, dispatched, terminal, delivered)).toEqual(action({ kind: "record", jobId: "A1" }));
  });

  it("dispatches the next run of the same cell straight away — the container already has the cell", () => {
    expect(next(SETUP, apply("A", A), STOP, STOPPED, ...run("A", 1, "A1"))).toEqual(
      action({ kind: "dispatch", cell: "A", slot: 2, attempt: 1 }),
    );
  });

  it("moves to the next cell with a fresh apply and stop", () => {
    expect(next(SETUP, ...cell("A", A))).toEqual(action({ kind: "apply-cell", cell: "B", tuning: B }));
  });
});

describe("nextStep — the failure policy", () => {
  const base = [SETUP, apply("A", A), STOP, STOPPED] as const;

  it("retries an excluded run once, after stopping the container that produced it", () => {
    const failed = run("A", 1, "bad", {
      excluded: "wrong cell: dispatched under w4-s120-a300, solved under w4-s60-a300",
    });

    expect(next(...base, ...failed)).toEqual(action({ kind: "stop-container" }));
    expect(next(...base, ...failed, STOP, STOPPED)).toEqual(
      action({ kind: "dispatch", cell: "A", slot: 1, attempt: 2 }),
    );
  });

  it("halts after a second bad outcome for the same slot, naming both reasons", () => {
    const step = next(
      ...base,
      ...run("A", 1, "bad1", { excluded: "status failed (solver-error)" }),
      STOP,
      STOPPED,
      ...run("A", 1, "bad2", { attempt: 2, excluded: "no solver_config" }),
    );

    expect(step).toEqual({
      kind: "halt",
      reason: "cell A run 1 failed twice — status failed (solver-error); no solver_config",
    });
  });

  it("counts a dispatch that never produced a job as a bad outcome", () => {
    const refused: Pair = [
      { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
      { kind: "dispatch-failed", error: "CONFLICT: A generation is already running", liveVersion: "v1@100" },
    ];

    expect(next(...base, refused)).toEqual(action({ kind: "stop-container" }));
    expect(next(...base, refused, STOP, STOPPED, refused)).toMatchObject({ kind: "halt" });
  });

  it("forgives the failures before a resume, and retries", () => {
    const step = next(
      ...base,
      ...run("A", 1, "bad1", { excluded: "status failed (solver-error)" }),
      STOP,
      STOPPED,
      ...run("A", 1, "bad2", { attempt: 2, excluded: "status failed (solver-error)" }),
      { type: "resume", at: "" },
      STOP,
      STOPPED,
    );

    expect(step).toEqual(action({ kind: "dispatch", cell: "A", slot: 1, attempt: 3 }));
  });

  it("halts when the container refuses to stop, and stops again once a human resumes", () => {
    const busy: Pair = [{ kind: "stop-container" }, { kind: "stop-container", outcome: "busy" }];

    expect(next(SETUP, apply("A", A), busy)).toMatchObject({ kind: "halt" });
    expect(next(SETUP, apply("A", A), busy, { type: "resume", at: "" })).toEqual(action({ kind: "stop-container" }));
  });
});

describe("nextStep — the Cell D pause", () => {
  const abc = [SETUP, ...cell("A", A), ...cell("B", B), ...cell("C", C)];

  it("parks before pausing, so production does not wait on campaign budgets", () => {
    expect(next(...abc)).toEqual(action({ kind: "park" }));
    expect(next(...abc, PARK)).toEqual({ kind: "pause", reason: "choose-cell-d" });
  });

  it("lifts the pause with a set-cell entry, and the first Cell D dispatch follows the full sequence", () => {
    const chosen: JournalEntry = { type: "set-cell", at: "", cell: "D", tuning: D };

    expect(next(...abc, PARK, chosen)).toEqual(action({ kind: "apply-cell", cell: "D", tuning: D }));
    expect(next(...abc, PARK, chosen, apply("D", D), STOP, STOPPED)).toEqual(
      action({ kind: "dispatch", cell: "D", slot: 1, attempt: 1 }),
    );
  });

  it("parks at the end of the grid, then is done", () => {
    const all = [...abc, PARK, { type: "set-cell", at: "", cell: "D", tuning: D } as JournalEntry, ...cell("D", D)];

    expect(next(...all)).toEqual(action({ kind: "park" }));
    expect(next(...all, PARK)).toEqual({ kind: "done" });
    expect(gridComplete(replay(journalOf(...all, PARK)))).toBe(true);
    expect(gridComplete(replay(journalOf(...abc, PARK)))).toBe(false);
  });

  it("runs one under main's constants on request: no override, a cold start, then the dispatch", () => {
    const all = [...abc, PARK, { type: "set-cell", at: "", cell: "D", tuning: D } as JournalEntry, ...cell("D", D)];
    const request: JournalEntry = { type: "run-one", at: "" };

    expect(next(...all, request)).toEqual(action({ kind: "park" }));
    expect(next(...all, PARK, request)).toEqual(action({ kind: "stop-container" }));
    expect(next(...all, PARK, request, STOP, STOPPED)).toEqual(
      action({ kind: "dispatch", cell: "main", slot: 1, attempt: 1 }),
    );
    expect(next(...all, PARK, request, STOP, STOPPED, ...run("main", 1, "M1"))).toEqual({ kind: "done" });
  });
});

describe("nextStep — reconciling an interrupted action", () => {
  it("returns a trailing intent with no outcome as itself, carrying its seq and time", () => {
    const entries = [
      ...journalOf(SETUP, apply("A", A), STOP, STOPPED),
      {
        type: "intent",
        seq: 9,
        at: "2026-10-01T09:00:00.000Z",
        action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
      },
    ] satisfies JournalEntry[];

    expect(nextStep(replay(entries))).toEqual({
      kind: "act",
      action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
      reconcile: {
        seq: 9,
        at: "2026-10-01T09:00:00.000Z",
        action: { kind: "dispatch", cell: "A", slot: 1, attempt: 1 },
      },
    });
  });
});

describe("cleanupStep — the strict order", () => {
  const ran = [SETUP, apply("A", A), STOP, STOPPED, ...run("A", 1, "A1"), ...run("A", 2, "A2")];
  const steps = (...items: readonly (Pair | JournalEntry)[]) => cleanupStep(replay(journalOf(...items)));

  it("delivers every proposal, deletes each by id, deletes the campaign plan, then parks", () => {
    const delivered = (id: string): Pair => [
      { kind: "cleanup-deliver", proposalPlanId: id },
      { kind: "cleanup-deliver" },
    ];
    const deleted = (id: string, role: "proposal" | "campaign"): Pair => [
      { kind: "delete-plan", planId: id, role },
      { kind: "delete-plan" },
    ];

    expect(steps(...ran)).toEqual(action({ kind: "cleanup-deliver", proposalPlanId: "proposal-A1" }));
    expect(steps(...ran, delivered("proposal-A1"))).toEqual(
      action({ kind: "cleanup-deliver", proposalPlanId: "proposal-A2" }),
    );
    const allDelivered = [...ran, delivered("proposal-A1"), delivered("proposal-A2")];
    expect(steps(...allDelivered)).toEqual(action({ kind: "delete-plan", planId: "proposal-A1", role: "proposal" }));
    const proposalsGone = [...allDelivered, deleted("proposal-A1", "proposal"), deleted("proposal-A2", "proposal")];
    expect(steps(...proposalsGone)).toEqual(action({ kind: "delete-plan", planId: "campaign", role: "campaign" }));
    expect(steps(...proposalsGone, deleted("campaign", "campaign"))).toEqual(action({ kind: "park" }));
    expect(steps(...proposalsGone, deleted("campaign", "campaign"), PARK)).toEqual({ kind: "done" });
  });

  it("refuses while a job is still solving", () => {
    const [dispatched] = run("A", 3, "A3");

    expect(steps(...ran, dispatched)).toEqual({
      kind: "halt",
      reason: "job A3 is still solving — let it finish first",
    });
  });
});
