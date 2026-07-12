import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { course } from "../../../__fixtures__/builders";
import { mulberry32 } from "../../rng";
import type { GeneratorSnapshot } from "../../types";
import { verifyGeneration } from "../../verify";
import { createBoard } from "./board";
import { buildProblem } from "./problem";
import { type AttemptContext, migrateHolesToEdges, repairStragglers } from "./stages";

/**
 * Worked-example tests for the two hardest-to-read board-mutation helpers, driven through their
 * exported stages so no internal surface is widened: `repairStragglers` exercises the recursive
 * ejection-chain `chainFit`, and `migrateHolesToEdges` exercises `migrateCohortHoles`. The engine's
 * black-box fuzz/quality suites already carry end-to-end validity; these pin the observable
 * before→after of the inner loops so a future reader has a concrete example of the mechanism.
 */

/** A one-hour agnostic course (the minimal unit; hours are inert once a row is on the board). */
const hourCourse = (id: string, teacher: string, students: string[]): GroupingCourse => ({
  ...course(id, teacher, students),
  hours: 1,
});

/** A single-cohort snapshot (dp2 empty) on a `days × periods` grid, no pins/availability. */
const snapshotOf = (days: number, periods: number, dp1: GroupingCourse[]): GeneratorSnapshot => ({
  days,
  periods,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: { courses: dp1, pins: [], parkedCourseIds: [] },
    dp2: { courses: [], pins: [], parkedCourseIds: [] },
  },
});

/** An attempt context with deterministic rng and no cancel/yield — the stages' only non-board input. */
const attemptCtx = (over: Partial<AttemptContext> = {}): AttemptContext => ({
  rng: mulberry32(1),
  noise: 0,
  backbone: { dp1: new Set<string>(), dp2: new Set<string>() },
  reserved: { dp1: new Set<string>(), dp2: new Set<string>() },
  cohortOrder: ["dp1"],
  descentUntil: 0,
  stopped: () => false,
  maybeYield: () => Promise.resolve(),
  ...over,
});

describe("repairStragglers → chainFit (ejection-chain repair)", () => {
  it("places a straggler that fits no occupied cell directly, by evicting and re-homing an occupant", () => {
    // A and B occupy the only two cells and do NOT conflict (so they can co-locate). The straggler S
    // shares a student with each, so it fits NEITHER cell directly. The one way in: evict an occupant,
    // re-home it into the other used cell, leaving its cell free for S — that is what chainFit does.
    const A = hourCourse("A", "tA", ["sX"]);
    const B = hourCourse("B", "tB", ["sY"]);
    const S = hourCourse("S", "tS", ["sX", "sY"]);
    const snapshot = snapshotOf(1, 2, [A, B, S]);
    const problem = buildProblem(snapshot);
    const board = createBoard(problem);
    board.place("dp1", "A", 1, 1, "both");
    board.place("dp1", "B", 1, 2, "both");
    board.remaining.set("S", 1);

    // Precondition the chain is the only route: S cannot enter either occupied cell directly.
    expect(board.fitsAt("dp1", S, 1, 1)).toBeNull();
    expect(board.fitsAt("dp1", S, 1, 2)).toBeNull();

    repairStragglers(board, problem, attemptCtx());

    expect(board.remaining.get("S")).toBe(0); // the straggler was placed
    expect(board.placements.filter((r) => r.courseId === "S")).toHaveLength(1);
    // The chain preserved validity — the co-located pair shares a cell but never a teacher/student.
    expect(verifyGeneration(snapshot, board.placements).ok).toBe(true);
  });
});

describe("migrateHolesToEdges → migrateCohortHoles (interior-hole collapse)", () => {
  it("pulls a day-edge course into an interior free period, freeing the edge", () => {
    // Day 1 holds courses at periods 1 and 3 with period 2 an interior hole. Stage 7 slides the
    // period-1 course inward to period 2, so the free cell ends up at the day edge (period 1).
    const X = hourCourse("X", "tX", ["sX"]);
    const Y = hourCourse("Y", "tY", ["sY"]);
    const snapshot = snapshotOf(1, 3, [X, Y]);
    const problem = buildProblem(snapshot);
    const board = createBoard(problem);
    board.place("dp1", "X", 1, 1, "both");
    board.place("dp1", "Y", 1, 3, "both");

    expect(board.rowsAt("dp1", 1, 2)).toHaveLength(0); // interior hole, periods 1 & 3 occupied

    migrateHolesToEdges(board, problem, attemptCtx());

    expect(board.rowsAt("dp1", 1, 1)).toHaveLength(0); // freed edge
    expect(board.rowsAt("dp1", 1, 2).map((r) => r.courseId)).toEqual(["X"]); // hole filled
    expect(board.rowsAt("dp1", 1, 3).map((r) => r.courseId)).toEqual(["Y"]); // untouched
  });
});
