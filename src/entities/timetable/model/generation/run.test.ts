import { describe, expect, it, vi } from "vitest";
import { course, placement } from "../__fixtures__/builders";
import { runVerifiedGeneration } from "./run";
import type { GeneratePlan, GenerationResult, GeneratorSnapshot } from "./types";

const CONFIG = { budgetMs: 1_000 };

/** A clean empty-board snapshot with one dp1 course to place. */
const cleanSnapshot = (): GeneratorSnapshot => ({
  days: 3,
  periods: 4,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: { courses: [course("a", "t-a", ["s1"])], pins: [], parkedCourseIds: [] },
    dp2: { courses: [], pins: [], parkedCourseIds: [] },
  },
});

/** Two dp1 courses share teacher `t`, both pinned to (1,1) — a blocking teacher collision among pins. */
const dirtyPinsSnapshot = (): GeneratorSnapshot => ({
  days: 3,
  periods: 4,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: {
      courses: [course("a", "t", ["s1"]), course("b", "t", ["s2"])],
      pins: [placement("pa", "a", 1, 1), placement("pb", "b", 1, 1)],
      parkedCourseIds: [],
    },
    dp2: { courses: [], pins: [], parkedCourseIds: [] },
  },
});

/** A fake engine that places course `a` once at (1,1) — a valid board on `cleanSnapshot`. */
const fakeEngineResult: GenerationResult = {
  placements: [{ cohort: "dp1", courseId: "a", day: 1, period: 1, week: "both" }],
  diagnostics: {
    engine: "fake",
    elapsedMs: 0,
    partial: false,
    cohorts: {
      dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
      dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
    },
  },
};

describe("runVerifiedGeneration", () => {
  it("rejects a dirty-pins snapshot before invoking the engine (precondition)", async () => {
    const engine: GeneratePlan = vi.fn(() =>
      Promise.reject(new Error("engine must not be invoked when the precondition fails")),
    );

    const outcome = await runVerifiedGeneration(engine, dirtyPinsSnapshot(), CONFIG);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("precondition");
    expect(outcome.verdict.ok).toBe(false);
    expect(engine).not.toHaveBeenCalled();
  });

  it("runs the injected engine and re-judges its output on a clean snapshot (happy path)", async () => {
    const snapshot = cleanSnapshot();
    const engine: GeneratePlan = vi.fn(() => Promise.resolve(fakeEngineResult));

    const outcome = await runVerifiedGeneration(engine, snapshot, CONFIG);

    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledWith(snapshot, CONFIG, undefined);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toBe(fakeEngineResult);
      // The verdict comes from the real verifyGeneration judging the fake engine's board.
      expect(outcome.verdict.ok).toBe(true);
      expect(outcome.verdict.reasons).toEqual([]);
    }
  });
});
