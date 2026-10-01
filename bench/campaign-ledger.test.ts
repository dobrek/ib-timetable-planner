import { describe, expect, it } from "vitest";
import { course, type GenerationResult, type GeneratorSnapshot, type StoredSolverConfig } from "@/entities/timetable";
import {
  deliveredObjective,
  formatLedgerMarkdown,
  mergeLedger,
  parseCellMapping,
  parseLedgerFile,
  serializeLedger,
  toLedgerRow,
  type LedgerExpectations,
  type LoadedJob,
} from "./campaign-ledger";

/**
 * The ledger is the campaign's record of record once the source plan is deleted, so what these tests
 * pin is what a later reader depends on: a run counts only on facts, a second extraction never
 * duplicates or loses a row, and nothing that could carry a name reaches the file or the paste.
 */
const solverConfig = (overrides: Partial<StoredSolverConfig> = {}): StoredSolverConfig => ({
  version: 1,
  workers: 4,
  stageBudgetS: 120,
  modeABudgetS: 300,
  seed: 0,
  budgetSource: { stage: "configured", modeA: "configured" },
  targets: {},
  preset: "clean",
  cleanMode: true,
  host: { machine: "x86_64", cpuCount: 4, ortools: "9.12.4544" },
  cleanFallback: false,
  ...overrides,
});

const job = (overrides: Partial<LoadedJob> = {}): LoadedJob => ({
  id: "3f2a0000-0000-4000-8000-000000000001",
  planId: "9a000000-0000-4000-8000-000000000001",
  proposalPlanId: "9b000000-0000-4000-8000-000000000001",
  delivered: true,
  preset: "clean",
  status: "succeeded",
  createdAt: "2026-10-01T10:00:00.000Z",
  startedAt: "2026-10-01T10:00:40.000Z",
  finishedAt: "2026-10-01T10:16:40.000Z",
  stages: [
    { tier: 1, name: "completeness", status: "OPTIMAL", best: 0, wallClockS: 2.5 },
    { tier: 3, name: "totalSlots", status: "FEASIBLE", best: 95, bound: 90, wallClockS: 120, stoppedBy: "budget" },
  ],
  solverConfig: solverConfig(),
  error: null,
  ...overrides,
});

const expectations = (overrides: Partial<LedgerExpectations> = {}): LedgerExpectations => ({
  cells: new Map(),
  requireSolverConfig: false,
  host: null,
  ...overrides,
});

const TUPLE = [0, 3, 95, 12, 0, 40, 3, 1, 2, 7];

describe("toLedgerRow", () => {
  it("derives the cell from what the row says solved it, and the three clocks from its timestamps", () => {
    const row = toLedgerRow(job(), expectations(), TUPLE);

    expect(row.cell).toBe("w4-s120-a300");
    expect(row.attribution).toBe("solver_config");
    expect(row.clocks).toEqual({
      createdAt: "2026-10-01T10:00:00.000Z",
      startedAt: "2026-10-01T10:00:40.000Z",
      finishedAt: "2026-10-01T10:16:40.000Z",
      queueToClaimS: 40,
      endToEndS: 960,
      stageSumS: 122.5,
      unaccountedS: 837.5,
    });
    expect(row.deliveredObjective).toEqual(TUPLE);
    expect(row.excluded).toBeNull();
  });

  it("rounds the derived clocks to the millisecond, so summing stage clocks leaves no float noise", () => {
    // 22.48 + 45.752351 sums to 68.23235100000001 in binary floating point — a real ledger value.
    const row = toLedgerRow(
      job({
        stages: [
          { tier: 1, name: "completeness", status: "OPTIMAL", best: 0, wallClockS: 22.48 },
          { tier: 3, name: "totalSlots", status: "FEASIBLE", best: 95, wallClockS: 45.752351, stoppedBy: "budget" },
        ],
      }),
      expectations(),
      null,
    );

    expect(row.clocks.stageSumS).toBe(68.232);
    expect(row.clocks.unaccountedS).toBe(891.768);
  });

  it("takes a legacy row's cell from the mapping, since the row cannot say", () => {
    const row = toLedgerRow(
      job({ solverConfig: null }),
      expectations({ cells: new Map([[job().id, "w4-s120-a300"]]) }),
      null,
    );

    expect(row.cell).toBe("w4-s120-a300");
    expect(row.attribution).toBe("mapping");
    expect(row.excluded).toBeNull();
  });

  it("does not count a run that did not succeed, and names the error by kind rather than by text", () => {
    // The translation path quotes a course's natural key — its NAME — so the text must never reach the
    // ledger. Only the fixed kind does.
    const row = toLedgerRow(
      job({
        status: "failed",
        error: 'the result could not be translated onto the proposal plan: ["dp1","Chemistry","HL",1]',
      }),
      expectations(),
      null,
    );

    expect(row.excluded).toBe("status failed (translation)");
    expect(row.errorKind).toBe("translation");
    expect(JSON.stringify(row)).not.toContain("Chemistry");
  });

  it("reads an unrecognised error as `other`, never as its text", () => {
    expect(toLedgerRow(job({ status: "failed", error: "Something new" }), expectations(), null).errorKind).toBe(
      "other",
    );
  });

  it("excludes a run that solved under a cell other than the one it was dispatched under", () => {
    // The stale-container case: the secret said one cell, the warm container still solved another.
    const row = toLedgerRow(job(), expectations({ cells: new Map([[job().id, "w4-s60-a300"]]) }), TUPLE);

    expect(row.excluded).toBe("wrong cell: dispatched under w4-s60-a300, solved under w4-s120-a300");
  });

  it("excludes a row without solver_config when the campaign requires one, even if mapped", () => {
    const row = toLedgerRow(
      job({ solverConfig: null }),
      expectations({ cells: new Map([[job().id, "w4-s120-a300"]]), requireSolverConfig: true }),
      null,
    );

    expect(row.excluded).toBe("no solver_config");
  });

  it("excludes a row nothing attributes", () => {
    expect(toLedgerRow(job({ solverConfig: null }), expectations(), null).excluded).toBe(
      "unattributed: no solver_config and no cell mapping",
    );
  });

  it("excludes a run solved on a host other than the expected one — a laptop against hosted data", () => {
    const row = toLedgerRow(
      job({ solverConfig: solverConfig({ host: { machine: "arm64", cpuCount: 10, ortools: "9.12.4544" } }) }),
      expectations({ host: "x86_64/4" }),
      TUPLE,
    );

    expect(row.excluded).toBe("wrong host: arm64/10, expected x86_64/4");
  });
});

describe("mergeLedger", () => {
  it("leaves one row when the same job is extracted twice", () => {
    const first = mergeLedger([], [toLedgerRow(job(), expectations(), TUPLE)]);
    const second = mergeLedger(first, [toLedgerRow(job(), expectations(), TUPLE)]);

    expect(second).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("keeps the rows an extraction did not select, and lets a fresh row replace its stale copy", () => {
    const other = job({ id: "other", createdAt: "2026-10-01T09:00:00.000Z" });
    const running = job({ status: "running", finishedAt: null });
    const before = mergeLedger(
      [],
      [toLedgerRow(other, expectations(), TUPLE), toLedgerRow(running, expectations(), null)],
    );

    const after = mergeLedger(before, [toLedgerRow(job(), expectations(), TUPLE)]);

    expect(after.map((row) => [row.jobId, row.status])).toEqual([
      ["other", "succeeded"],
      [job().id, "succeeded"],
    ]);
  });

  it("keeps a computed tuple when a later extraction skipped the heavy read", () => {
    const merged = mergeLedger(mergeLedger([], [toLedgerRow(job(), expectations(), TUPLE)]), [
      toLedgerRow(job(), expectations(), null),
    ]);

    expect(merged[0]?.deliveredObjective).toEqual(TUPLE);
  });

  it("numbers runs within a cell by creation time, skipping the ones that do not count", () => {
    const runs = [
      job({ id: "a1", createdAt: "2026-10-01T10:00:00.000Z" }),
      job({ id: "a-failed", createdAt: "2026-10-01T10:20:00.000Z", status: "failed", error: "solver error: boom" }),
      job({ id: "b1", createdAt: "2026-10-01T10:30:00.000Z", solverConfig: solverConfig({ stageBudgetS: 60 }) }),
      job({ id: "a2", createdAt: "2026-10-01T10:40:00.000Z" }),
    ];

    const ledger = mergeLedger(
      [],
      runs.map((run) => toLedgerRow(run, expectations(), null)),
    );

    expect(ledger.map((row) => [row.jobId, row.cell, row.run])).toEqual([
      ["a1", "w4-s120-a300", 1],
      ["a-failed", "w4-s120-a300", null],
      ["b1", "w4-s60-a300", 1],
      ["a2", "w4-s120-a300", 2],
    ]);
  });
});

describe("the ledger file", () => {
  it("round-trips through its JSON form", () => {
    const ledger = mergeLedger([], [toLedgerRow(job(), expectations(), TUPLE)]);

    expect(parseLedgerFile(serializeLedger(ledger))).toEqual(ledger);
  });

  it("refuses a file it did not write rather than merging into it", () => {
    expect(() => parseLedgerFile(JSON.stringify({ version: 2, rows: [] }))).toThrow();
  });
});

describe("parseCellMapping", () => {
  it("reads <job>:<cell> pairs", () => {
    expect(parseCellMapping(" a:w4-s120-a300 , b:w4-s60-a300 ")).toEqual(
      new Map([
        ["a", "w4-s120-a300"],
        ["b", "w4-s60-a300"],
      ]),
    );
  });

  it("is empty when unset and loud when malformed", () => {
    expect(parseCellMapping("")).toEqual(new Map());
    expect(() => parseCellMapping("a-without-cell")).toThrow(/<job>:<cell>/);
  });
});

describe("formatLedgerMarkdown", () => {
  it("prints one run row and one per-tier row per job, with the exclusion reason inline", () => {
    const ledger = mergeLedger(
      [],
      [
        toLedgerRow(job(), expectations(), TUPLE),
        toLedgerRow(
          job({ id: "failed-job", createdAt: "2026-10-01T11:00:00.000Z", status: "failed", error: "infeasible: x" }),
          expectations(),
          null,
        ),
      ],
    );

    const markdown = formatLedgerMarkdown(ledger);

    expect(markdown).toMatch(/\| w4-s120-a300 \| 1 +\| 3f2a0000-0000-4000-8000-000000000001 \|/);
    expect(markdown).toContain("[0,3,95,12,0,40,3,1,2,7]");
    expect(markdown).toContain("no: status failed (infeasible)");
    expect(markdown).toContain("95/90 FEASIBLE budget");
    expect(markdown).toContain("not-fired");
  });
});

describe("deliveredObjective", () => {
  it("scores the delivered board and reads tier 1 from the result's own unplaced hours", () => {
    const snapshot: GeneratorSnapshot = {
      days: 5,
      periods: 8,
      availability: [],
      finishesEarlyByCourseId: [],
      cohorts: {
        dp1: { courses: [course("c1", "t1", ["s1"])], pins: [], parkedCourseIds: [] },
        dp2: { courses: [], pins: [], parkedCourseIds: [] },
      },
    };
    const result: GenerationResult = {
      placements: [{ cohort: "dp1", courseId: "c1", day: 1, period: 1, week: "both" }],
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 10,
        partial: false,
        cohorts: {
          dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [{ courseId: "c1", missing: 3 }] },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
        },
      },
    };

    const tuple = deliveredObjective(snapshot, result);

    expect(tuple).toHaveLength(10);
    expect(tuple[0]).toBe(3);
    expect(tuple[2]).toBe(1);
  });
});
