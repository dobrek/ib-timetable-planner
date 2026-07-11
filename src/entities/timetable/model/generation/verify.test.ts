import { describe, expect, it } from "vitest";
import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { BoardAvailabilityCell } from "../availability-index";
import { biweekly, course, placement } from "../__fixtures__/builders";
import type { PlannerPlacement } from "../placement";
import type { GeneratedPlacement, GeneratorSnapshot } from "./types";
import { verifyGeneration } from "./verify";

type CohortSeed = { courses?: GroupingCourse[]; pins?: PlannerPlacement[] };

const snapshot = (opts: {
  days?: number;
  periods?: number;
  availability?: BoardAvailabilityCell[];
  flagged?: string[];
  dp1?: CohortSeed;
  dp2?: CohortSeed;
}): GeneratorSnapshot => ({
  days: opts.days ?? 5,
  periods: opts.periods ?? 4,
  availability: opts.availability ?? [],
  finishesEarlyByCourseId: opts.flagged ?? [],
  cohorts: {
    dp1: { courses: opts.dp1?.courses ?? [], pins: opts.dp1?.pins ?? [], parkedCourseIds: [] },
    dp2: { courses: opts.dp2?.courses ?? [], pins: opts.dp2?.pins ?? [], parkedCourseIds: [] },
  },
});

const gen = (
  cohort: Cohort,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
): GeneratedPlacement => ({ cohort, courseId, day, period, week });

describe("verifyGeneration", () => {
  it("accepts a clean result (disjoint courses sharing a cell)", () => {
    const board = snapshot({ dp1: { courses: [course("math", "t1", ["s1"]), course("eng", "t2", ["s2"])] } });

    const verdict = verifyGeneration(board, [gen("dp1", "math", 1, 1), gen("dp1", "eng", 1, 1)]);

    expect(verdict).toEqual({ ok: true, reasons: [], softWarnCount: 0 });
  });

  it("accepts an opposite-week biweekly pair sharing teacher, student, and cell", () => {
    const board = snapshot({ dp1: { courses: [biweekly("bio-a", "t1", ["s1"]), biweekly("bio-b", "t1", ["s1"])] } });

    const verdict = verifyGeneration(board, [gen("dp1", "bio-a", 1, 1, "a"), gen("dp1", "bio-b", 1, 1, "b")]);

    expect(verdict.ok).toBe(true);
  });

  it("rejects a cell outside the grid bounds", () => {
    const board = snapshot({ periods: 4, dp1: { courses: [course("math", "t1")] } });

    const verdict = verifyGeneration(board, [gen("dp1", "math", 1, 5)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining("outside the 5×4 grid")]);
  });

  it("rejects week_mode ↔ week inconsistency in both directions", () => {
    const board = snapshot({ dp1: { courses: [course("agnostic", "t1"), biweekly("bi", "t2")] } });

    const agnosticOnA = verifyGeneration(board, [gen("dp1", "agnostic", 1, 1, "a")]);
    const biweeklyOnBoth = verifyGeneration(board, [gen("dp1", "bi", 1, 1, "both")]);

    expect(agnosticOnA.ok).toBe(false);
    expect(agnosticOnA.reasons).toEqual([expect.stringContaining("inconsistent with week_mode")]);
    expect(biweeklyOnBoth.ok).toBe(false);
  });

  it("rejects a course missing from the cohort catalog (the core would silently skip it)", () => {
    const board = snapshot({ dp1: { courses: [course("math", "t1")] } });

    const verdict = verifyGeneration(board, [gen("dp1", "ghost", 1, 1)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining("missing from the dp1 catalog")]);
  });

  it("rejects duplicate cell rows — within the generated set and against a pin", () => {
    const board = snapshot({
      dp1: { courses: [course("math", "t1")], pins: [placement("p1", "math", 2, 2)] },
    });

    const selfDup = verifyGeneration(board, [gen("dp1", "math", 1, 1), gen("dp1", "math", 1, 1)]);
    const pinDup = verifyGeneration(board, [gen("dp1", "math", 2, 2)]);

    expect(selfDup.ok).toBe(false);
    expect(selfDup.reasons).toEqual([expect.stringContaining("duplicate cell row")]);
    expect(pinDup.ok).toBe(false);
  });

  it("rejects a blocking student conflict between a generated row and a pin", () => {
    const board = snapshot({
      dp1: {
        courses: [course("math", "t1", ["s1"]), course("eng", "t2", ["s1"])],
        pins: [placement("p1", "math", 1, 1)],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "eng", 1, 1)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining("blocking student")]);
  });

  it("rejects a cross-cohort teacher clash between a dp1 pin and a dp2 generated row", () => {
    const board = snapshot({
      dp1: { courses: [course("dp1-math", "t-shared")], pins: [placement("p1", "dp1-math", 1, 1)] },
      dp2: { courses: [course("dp2-math", "t-shared")] },
    });

    const verdict = verifyGeneration(board, [gen("dp2", "dp2-math", 1, 1)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("cross-cohort-teacher"))).toBe(true);
  });

  it("rejects a 3-stack created by generated placements (generator-hard 2/day cap)", () => {
    const board = snapshot({ dp1: { courses: [course("math", "t1")] } });

    const verdict = verifyGeneration(board, [
      gen("dp1", "math", 1, 1),
      gen("dp1", "math", 1, 2),
      gen("dp1", "math", 1, 3),
    ]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("course-day-stacking"))).toBe(true);
  });

  it("permits a pre-existing pins-only 3-stack (warns never block Generate)", () => {
    const board = snapshot({
      dp1: {
        courses: [course("math", "t1"), course("eng", "t2")],
        pins: [placement("p1", "math", 1, 1), placement("p2", "math", 1, 2), placement("p3", "math", 1, 3)],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "eng", 2, 1)]);

    expect(verdict.ok).toBe(true);
  });

  it("permits and counts soft teacher-availability warns", () => {
    const board = snapshot({
      availability: [{ teacherKey: "t1", day: 1, period: 1, severity: "soft" }],
      dp1: { courses: [course("math", "t1")] },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "math", 1, 1)]);

    expect(verdict.ok).toBe(true);
    expect(verdict.softWarnCount).toBe(1);
  });

  it("rejects a strong teacher-availability violation", () => {
    const board = snapshot({
      availability: [{ teacherKey: "t1", day: 1, period: 1, severity: "strong" }],
      dp1: { courses: [course("math", "t1")] },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "math", 1, 1)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining("blocking teacher-unavailable")]);
  });

  it("rejects an interior placement of a finishes_early course (blocking edge rule)", () => {
    const board = snapshot({
      flagged: ["hist"],
      dp1: {
        courses: [course("hist", "t3", ["s1"]), course("math", "t1", ["s1"]), course("eng", "t2", ["s1"])],
        pins: [placement("p1", "math", 1, 1), placement("p2", "eng", 1, 3)],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "hist", 1, 2)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringContaining("blocking early-finish-edge")]);
  });
});
