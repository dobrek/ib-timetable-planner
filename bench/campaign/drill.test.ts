import { describe, expect, it } from "vitest";
import { gridFor } from "./definition.ts";
import { drillProblems, haltedLabelPattern, nextDrillStep } from "./drill.ts";
import type { ActionResult, DrillFact, JournalAction, JournalEntry } from "./journal.ts";
import { replay } from "./journal.ts";

/**
 * The drill is attended and runs once, on production, so its ORDER is what must be right before that
 * day: the 240 s cell's full sequence, deploy only after a checkpoint, the label and the self-heal, the
 * secret change under the self-heal, and the push last. Each test walks the journal one step further.
 */
const cellNamed = (key: "A" | "C") => {
  const cell = gridFor("production", null).find((candidate) => candidate.key === key);
  if (cell === undefined) throw new Error(`the production grid has no cell ${key}`);
  return cell;
};
const cellA = cellNamed("A");
const cellC = cellNamed("C");

type Pair = readonly [JournalAction, ActionResult];

const isPair = (item: Pair | JournalEntry): item is Pair => Array.isArray(item);

const journalOf = (...items: readonly (Pair | JournalEntry)[]): JournalEntry[] =>
  items.flatMap((item, index) => {
    const at = new Date(Date.UTC(2026, 9, 2, 8, index)).toISOString();
    if (!isPair(item)) return [{ ...item, at }];
    const [action, result] = item;
    return [
      { type: "intent", seq: index + 1, at, action },
      { type: "outcome", seq: index + 1, at, result },
    ];
  });

const fact = (drillFact: DrillFact): JournalEntry => ({ type: "drill", at: "", fact: drillFact });

const SETUP: Pair = [
  { kind: "setup", target: "production", sourcePlanId: "source", name: "Calibration — test" },
  { kind: "setup", campaignPlanId: "campaign", remainingHours: 40 },
];
const APPLY_C: Pair = [{ kind: "apply-cell", cell: "C", tuning: cellC.tuning }, { kind: "apply-cell" }];
const STOP: Pair = [{ kind: "stop-container" }, { kind: "stop-container", outcome: "stop" }];
const STOPPED: Pair = [{ kind: "await-stopped" }, { kind: "await-stopped" }];
const DISPATCH_DRILL: Pair = [
  { kind: "dispatch", cell: "drill", slot: 1, attempt: 1 },
  { kind: "dispatch", jobId: "drill-job", proposalPlanId: "drill-proposal", liveVersion: "v1@100", adopted: false },
];
const INTERRUPTED: Pair = [
  { kind: "await-terminal", jobId: "drill-job" },
  { kind: "await-terminal", status: "interrupted", liveVersion: "v2@100" },
];
const DELIVERED: Pair = [
  { kind: "deliver", jobId: "drill-job", proposalPlanId: "drill-proposal" },
  { kind: "deliver", delivered: true, status: "interrupted" },
];
const RECORDED: Pair = [
  { kind: "record", jobId: "drill-job" },
  { kind: "record", excluded: "status interrupted (interrupted)", host: null },
];
const SELF_HEAL: Pair = [
  { kind: "dispatch", cell: "C", slot: 1, attempt: 1 },
  { kind: "dispatch", jobId: "c1-job", proposalPlanId: "c1-proposal", liveVersion: "v2@100", adopted: false },
];
const APPLY_A_UNDER_SOLVE: Pair = [
  { kind: "apply-cell", cell: "A", tuning: cellA.tuning, duringSolve: true },
  { kind: "apply-cell" },
];

const next = (...items: readonly (Pair | JournalEntry)[]) =>
  nextDrillStep(replay(journalOf(...items)), cellC, cellA.tuning);

const act = (action: JournalAction) => ({ kind: "act", action, reconcile: null });

const throughLabel = [
  SETUP,
  APPLY_C,
  STOP,
  STOPPED,
  DISPATCH_DRILL,
  fact({ kind: "checkpoint", position: 3 }),
  fact({ kind: "deployed", commit: "abc1234", version: "v2@100" }),
  INTERRUPTED,
  fact({ kind: "shutdown", askedAt: 1, writtenSeconds: 4.1 }),
  DELIVERED,
  fact({ kind: "label", position: 5, found: true }),
] as const;

describe("nextDrillStep", () => {
  it("runs the 240 s cell's full sequence before the drill dispatch", () => {
    expect(next(SETUP)).toEqual(act({ kind: "apply-cell", cell: "C", tuning: cellC.tuning }));
    expect(next(SETUP, APPLY_C)).toEqual(act({ kind: "stop-container" }));
    expect(next(SETUP, APPLY_C, STOP)).toEqual(act({ kind: "await-stopped" }));
    expect(next(SETUP, APPLY_C, STOP, STOPPED)).toEqual(act({ kind: "dispatch", cell: "drill", slot: 1, attempt: 1 }));
  });

  it("deploys only once a checkpoint at position 3 or later exists", () => {
    const dispatched = [SETUP, APPLY_C, STOP, STOPPED, DISPATCH_DRILL] as const;

    expect(next(...dispatched)).toEqual({ kind: "await-checkpoint", jobId: "drill-job" });
    expect(next(...dispatched, fact({ kind: "checkpoint", position: 3 }))).toEqual({
      kind: "deploy",
      jobId: "drill-job",
    });
  });

  it("settles an interrupted deploy from the live version rather than committing a second marker", () => {
    const started = [
      SETUP,
      APPLY_C,
      STOP,
      STOPPED,
      DISPATCH_DRILL,
      fact({ kind: "checkpoint", position: 3 }),
      fact({ kind: "deploy-started", commit: "abc1234", versionBefore: "v1@100" }),
    ] as const;
    const resume = { kind: "resume-deploy", jobId: "drill-job", commit: "abc1234", versionBefore: "v1@100" };

    expect(next(...started)).toEqual(resume);
    // The deploy in question may be what ended the row, so it is settled before the row is read.
    expect(next(...started, INTERRUPTED)).toEqual(resume);
  });

  it("halts when the solve ended before anything was deployed", () => {
    const step = next(SETUP, APPLY_C, STOP, STOPPED, DISPATCH_DRILL, [
      { kind: "await-terminal", jobId: "drill-job" },
      { kind: "await-terminal", status: "succeeded", liveVersion: "v1@100" },
    ]);

    expect(step).toMatchObject({ kind: "halt" });
  });

  it("after the deploy: waits for the row, then reads the shutdown pair, delivers, checks the label", () => {
    const deployed = [
      SETUP,
      APPLY_C,
      STOP,
      STOPPED,
      DISPATCH_DRILL,
      fact({ kind: "checkpoint", position: 3 }),
      fact({ kind: "deployed", commit: "abc1234", version: "v2@100" }),
    ] as const;

    expect(next(...deployed)).toEqual(act({ kind: "await-terminal", jobId: "drill-job" }));
    expect(next(...deployed, INTERRUPTED)).toEqual({ kind: "read-shutdown", jobId: "drill-job" });
    const shutdownRead = [
      ...deployed,
      INTERRUPTED,
      fact({ kind: "shutdown", askedAt: 1, writtenSeconds: 4.1 }),
    ] as const;
    expect(next(...shutdownRead)).toEqual(
      act({ kind: "deliver", jobId: "drill-job", proposalPlanId: "drill-proposal" }),
    );
    expect(next(...shutdownRead, DELIVERED)).toEqual({
      kind: "check-label",
      jobId: "drill-job",
      proposalPlanId: "drill-proposal",
    });
  });

  it("halts when the deploy did not interrupt the solve", () => {
    const step = next(
      SETUP,
      APPLY_C,
      STOP,
      STOPPED,
      DISPATCH_DRILL,
      fact({ kind: "checkpoint", position: 3 }),
      fact({ kind: "deployed", commit: "abc1234", version: "v2" }),
      [
        { kind: "await-terminal", jobId: "drill-job" },
        { kind: "await-terminal", status: "succeeded", liveVersion: "v2" },
      ],
    );

    expect(step).toEqual({ kind: "halt", reason: "the deploy did not interrupt the drill solve: it ended succeeded" });
  });

  it("halts when the proposal page does not render the halted-board label", () => {
    const step = next(...throughLabel.slice(0, -1), fact({ kind: "label", position: 5, found: false }));

    expect(step).toMatchObject({ kind: "halt" });
  });

  it("records the drill run, then dispatches the self-heal as Cell C run 1 with no further stop", () => {
    expect(next(...throughLabel)).toEqual(act({ kind: "record", jobId: "drill-job" }));
    expect(next(...throughLabel, RECORDED)).toEqual(act({ kind: "dispatch", cell: "C", slot: 1, attempt: 1 }));
  });

  it("switches the secret to Cell A UNDER the self-heal — no idle wait, no stop — then waits for it", () => {
    expect(next(...throughLabel, RECORDED, SELF_HEAL)).toEqual(
      act({ kind: "apply-cell", cell: "A", tuning: cellA.tuning, duringSolve: true }),
    );
    expect(next(...throughLabel, RECORDED, SELF_HEAL, APPLY_A_UNDER_SOLVE)).toEqual(
      act({ kind: "await-terminal", jobId: "c1-job" }),
    );
  });

  it("records whether the secret change disturbed the solve, then prints the push, then is done", () => {
    const healed = [
      ...throughLabel,
      RECORDED,
      SELF_HEAL,
      APPLY_A_UNDER_SOLVE,
      [
        { kind: "await-terminal", jobId: "c1-job" },
        { kind: "await-terminal", status: "succeeded", liveVersion: "v2@100" },
      ],
      [
        { kind: "deliver", jobId: "c1-job", proposalPlanId: "c1-proposal" },
        { kind: "deliver", delivered: true, status: "succeeded" },
      ],
      [
        { kind: "record", jobId: "c1-job" },
        { kind: "record", excluded: null, host: { machine: "x86_64", cpuCount: 4 } },
      ],
    ] as const satisfies readonly (Pair | JournalEntry)[];

    expect(next(...healed)).toEqual({ kind: "observe-secret-change", jobId: "c1-job", disturbed: false });
    const observed: JournalEntry = { type: "observation", at: "", key: "secret-change-during-solve", disturbed: false };
    expect(next(...healed, observed)).toEqual({ kind: "print-push" });
    expect(next(...healed, observed, fact({ kind: "push-printed", commit: "abc1234" }))).toEqual({ kind: "done" });
  });
});

describe("drillProblems", () => {
  it("names every unmet precondition", () => {
    expect(
      drillProblems({
        dockerRunning: false,
        treeClean: false,
        atOriginMain: false,
        imagePrebuilt: false,
        activeJobs: 1,
      }),
    ).toHaveLength(5);
    expect(
      drillProblems({ dockerRunning: true, treeClean: true, atOriginMain: true, imagePrebuilt: true, activeJobs: 0 }),
    ).toEqual([]);
  });
});

describe("haltedLabelPattern", () => {
  it("matches the label the proposal page renders for that position, and no other", () => {
    const html =
      "<span>Interrupted — kept the board from stage 5 of 10.<!-- --> Generate again when you are ready.</span>";

    expect(haltedLabelPattern(5).test(html)).toBe(true);
    expect(haltedLabelPattern(4).test(html)).toBe(false);
  });
});
