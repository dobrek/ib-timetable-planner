import { describe, expect, it } from "vitest";
import type { BoardAvailabilityCell } from "../availability-index";
import { course, placement } from "../__fixtures__/builders";
import { assembleGeneratorSnapshot } from "./assemble-snapshot";
import { computePinnedSoftFloor } from "./soft-floor";
import type { GeneratorSnapshot } from "./types";
import type { PlannerPlacement } from "../placement";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";

const soft = (teacherKey: string, day: number, period: number): BoardAvailabilityCell => ({
  teacherKey,
  day,
  period,
  severity: "soft",
});

const strong = (teacherKey: string, day: number, period: number): BoardAvailabilityCell => ({
  teacherKey,
  day,
  period,
  severity: "strong",
});

const snapshotOf = (
  availability: BoardAvailabilityCell[],
  dp1: { courses: GroupingCourse[]; placements: PlannerPlacement[] },
  dp2: { courses: GroupingCourse[]; placements: PlannerPlacement[] } = { courses: [], placements: [] },
): GeneratorSnapshot =>
  assembleGeneratorSnapshot(
    { days: 5, periods: 10, availability, finishesEarlyByCourseId: [] },
    {
      dp1: { ...dp1, parkedCourseIds: [] },
      dp2: { ...dp2, parkedCourseIds: [] },
    },
  );

/**
 * This is the TS mirror of the engine's `soft_hits_terms` floor. The cases below are deliberately the
 * same ones `services/solver/tests/test_objective.py` pins on the Python side — if the two formulas
 * ever drift, clean mode becomes unsatisfiable by construction and every solve silently falls back.
 */
describe("computePinnedSoftFloor", () => {
  it("is zero when no pin sits on a soft cell", () => {
    const snapshot = snapshotOf([soft("t1", 1, 1)], {
      courses: [course("math", "t1", ["s1"])],
      placements: [placement("row-1", "math", 2, 2)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(0);
  });

  it("counts one hit for a pin on its teacher's soft cell", () => {
    const snapshot = snapshotOf([soft("t1", 1, 1)], {
      courses: [course("math", "t1", ["s1"])],
      placements: [placement("row-1", "math", 1, 1)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(1);
  });

  it("counts ONE PER SOFT CO-TEACHER — a cell-set intersection would say 1 here", () => {
    const coTaught: GroupingCourse = { ...course("math", "t1", ["s1"]), teacherKeys: ["t1", "t2"] };
    const snapshot = snapshotOf([soft("t1", 1, 1), soft("t2", 1, 1)], {
      courses: [coTaught],
      placements: [placement("row-1", "math", 1, 1)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(2);
  });

  it("counts only the co-teachers who are actually soft at that cell", () => {
    const coTaught: GroupingCourse = { ...course("math", "t1", ["s1"]), teacherKeys: ["t1", "t2"] };
    const snapshot = snapshotOf([soft("t1", 1, 1)], {
      courses: [coTaught],
      placements: [placement("row-1", "math", 1, 1)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(1);
  });

  it("never dedups by cell — two pin rows sharing one soft cell count twice", () => {
    const snapshot = snapshotOf([soft("t1", 1, 1)], {
      courses: [course("a", "t1", ["s1"]), course("b", "t1", ["s2"])],
      placements: [placement("row-1", "a", 1, 1), placement("row-2", "b", 1, 1)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(2);
  });

  it("sums across both cohorts", () => {
    const snapshot = snapshotOf(
      [soft("t1", 1, 1), soft("t2", 2, 2)],
      { courses: [course("a", "t1", ["s1"])], placements: [placement("row-1", "a", 1, 1)] },
      { courses: [course("b", "t2", ["s2"])], placements: [placement("row-2", "b", 2, 2)] },
    );

    expect(computePinnedSoftFloor(snapshot)).toBe(2);
  });

  it("ignores STRONG cells — those are a hard block, not a tier-5 term", () => {
    const snapshot = snapshotOf([strong("t1", 1, 1)], {
      courses: [course("math", "t1", ["s1"])],
      placements: [placement("row-1", "math", 1, 1)],
    });

    expect(computePinnedSoftFloor(snapshot)).toBe(0);
  });

  it("ignores a pin whose course is not in the catalog — it has no teachers to be unavailable", () => {
    // Mirrors `_Occupancy.register`, which skips exactly these.
    const snapshot = snapshotOf([soft("t1", 1, 1)], { courses: [], placements: [placement("row-1", "ghost", 1, 1)] });

    expect(computePinnedSoftFloor(snapshot)).toBe(0);
  });

  it("is zero on an empty board", () => {
    expect(computePinnedSoftFloor(snapshotOf([soft("t1", 1, 1)], { courses: [], placements: [] }))).toBe(0);
  });
});
