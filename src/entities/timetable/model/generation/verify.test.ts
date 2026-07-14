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

  it("rejects a same-day split created by generated placements (generator-hard R1)", () => {
    const board = snapshot({ periods: 6, dp1: { courses: [course("math", "t1")] } });

    const verdict = verifyGeneration(board, [gen("dp1", "math", 1, 2), gen("dp1", "math", 1, 5)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("course-day-split"))).toBe(true);
  });

  it("accepts a consecutive same-day double (the double the expert deliberately seeks)", () => {
    const board = snapshot({ periods: 6, dp1: { courses: [course("math", "t1")] } });

    expect(verifyGeneration(board, [gen("dp1", "math", 1, 2), gen("dp1", "math", 1, 3)]).ok).toBe(true);
  });

  it("reads the course-day delta per week lane — a pins-only week-A split does not veto week B", () => {
    // The author pinned a split in week A. Week B of the same day is empty, and `board.fitsAt`
    // accepts a hour there (the lanes never meet). A lane-blind delta key rejected the whole board
    // because "that course has a generated row on that day".
    const board = snapshot({
      periods: 8,
      dp1: {
        courses: [biweekly("bio", "t1")],
        pins: [placement("p1", "bio", 1, 2, "a"), placement("p2", "bio", 1, 5, "a")],
      },
    });

    expect(verifyGeneration(board, [gen("dp1", "bio", 1, 8, "b")]).ok).toBe(true);
  });

  it("still rejects a split the generator creates in week B while week A is pin-split", () => {
    const board = snapshot({
      periods: 8,
      dp1: {
        courses: [biweekly("bio", "t1")],
        pins: [placement("p1", "bio", 1, 2, "a"), placement("p2", "bio", 1, 5, "a")],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "bio", 1, 4, "b"), gen("dp1", "bio", 1, 8, "b")]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("course-day-split"))).toBe(true);
  });

  it("permits a pre-existing pins-only split (delta semantics — pins are never the engine's fault)", () => {
    const board = snapshot({
      periods: 6,
      dp1: {
        courses: [course("math", "t1"), course("eng", "t2")],
        pins: [placement("p1", "math", 1, 2), placement("p2", "math", 1, 5)],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "eng", 2, 1)]);

    expect(verdict.ok).toBe(true);
  });

  it("rejects an over-long teacher day a generated row creates — across BOTH cohorts", () => {
    // The teacher's dp1 pin at P1 plus the generated dp2 row at P10 make one 10-period working day.
    const board = snapshot({
      periods: 10,
      dp1: { courses: [course("math", "t1")], pins: [placement("p1", "math", 1, 1)] },
      dp2: { courses: [course("phys", "t1")] },
    });

    const verdict = verifyGeneration(board, [gen("dp2", "phys", 1, 10)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("teacher-day-shape"))).toBe(true);
  });

  it("rejects a 7th consecutive teaching hour", () => {
    const courses = Array.from({ length: 7 }, (_, index) => course(`c${index + 1}`, "t1"));
    const board = snapshot({ periods: 10, dp1: { courses } });

    const verdict = verifyGeneration(
      board,
      courses.map((c, index) => gen("dp1", c.id, 1, index + 1)),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("teacher-day-shape"))).toBe(true);
  });

  it("accepts a teacher day at the exact bounds (span 8, 6 in a row)", () => {
    const periods = [1, 2, 3, 4, 5, 6, 8];
    const courses = periods.map((period) => course(`c${period}`, "t1"));
    const board = snapshot({ periods: 10, dp1: { courses } });

    expect(
      verifyGeneration(
        board,
        periods.map((period) => gen("dp1", `c${period}`, 1, period)),
      ).ok,
    ).toBe(true);
  });

  it("permits a pin-only over-long teacher day (delta semantics — no livelock on a dirty board)", () => {
    const board = snapshot({
      periods: 10,
      dp1: {
        courses: [course("math", "t1"), course("phys", "t1"), course("eng", "t2")],
        pins: [placement("p1", "math", 1, 1), placement("p2", "phys", 1, 10)],
      },
    });

    // The generated row is on another day — it participates in no over-long day of its own.
    expect(verifyGeneration(board, [gen("dp1", "eng", 2, 1)]).ok).toBe(true);
  });

  it("permits a generated row INSIDE a teacher day the pins already broke — the fitsAt delta, verify-side", () => {
    // t1's pins already span 10 periods on day 1. `board.fitsAt` accepts further placements on that
    // lane (it rejects only breaches the candidate CREATES), so verify must too — judging the day
    // board-wide instead made one hand-placed over-long teacher day reject every generated board,
    // after the full budget was spent and with nothing in the search loop to signal it.
    const board = snapshot({
      periods: 10,
      dp1: {
        courses: [course("math", "t1"), course("phys", "t1"), course("eng", "t1")],
        pins: [placement("p1", "math", 1, 1), placement("p2", "phys", 1, 10)],
      },
    });

    // Same teacher, same (already-broken) day — the generated hour creates no breach that was not
    // there when the engine was handed the board.
    expect(verifyGeneration(board, [gen("dp1", "eng", 1, 5)]).ok).toBe(true);
  });

  it("still rejects a breach the generator creates on a teacher day the pins left legal", () => {
    // t1's pins span 6 — legal. The generated row at P10 stretches the day to 10.
    const board = snapshot({
      periods: 10,
      dp1: {
        courses: [course("math", "t1"), course("phys", "t1"), course("eng", "t1")],
        pins: [placement("p1", "math", 1, 1), placement("p2", "phys", 1, 6)],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "eng", 1, 10)]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("teacher-day-shape"))).toBe(true);
  });

  it("reads the teacher-day delta per week lane — a pin-broken week A does not excuse week B", () => {
    // Week A is already broken by pins (span 10). Week B is clean, and the generated biweekly rows
    // break it: a lane-blind reading would tolerate this because "the day is broken anyway".
    const board = snapshot({
      periods: 10,
      dp1: {
        courses: [
          biweekly("math-a", "t1"),
          biweekly("phys-a", "t1"),
          biweekly("bio-b", "t1"),
          biweekly("chem-b", "t1"),
        ],
        pins: [placement("p1", "math-a", 1, 1, "a"), placement("p2", "phys-a", 1, 10, "a")],
      },
    });

    const verdict = verifyGeneration(board, [gen("dp1", "bio-b", 1, 1, "b"), gen("dp1", "chem-b", 1, 10, "b")]);

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.some((reason) => reason.includes("teacher-day-shape"))).toBe(true);
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
