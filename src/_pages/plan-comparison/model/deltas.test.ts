import { describe, expect, it } from "vitest";
import { analyzePlan } from "@/entities/timetable";
import {
  buildCohortSection,
  buildPlanSection,
  type AnalyzedPlan,
  type ScoreboardRow,
  type ScoreboardSection,
} from "./deltas";
import { BOARD_WIDE, COHORT_SCOREBOARD, CROSS_COHORT } from "./metric-catalog";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

const analyzed = (id: string, name: string, spec: PlanSpec): AnalyzedPlan => ({
  id,
  name,
  features: analyzePlan(buildLoadedPlan(spec).input),
});

/** Baseline: Maths placed twice on day 1. Comparand: the same board plus one more dp1 placement, so
 *  `Placement rows` genuinely differs and a delta has something to say. */
const BASE = analyzed("base", "Expert", {
  ...SAMPLE,
  rows: [
    { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
    { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 2, week: "both" },
  ],
});

const OTHER = analyzed("other", "Engine", {
  ...SAMPLE,
  rows: [
    { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
    { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 2, week: "both" },
    { cohort: "dp1", courseId: "p1-c-1", day: 3, period: 5, week: "both" },
  ],
});

const PLANS = [BASE, OTHER];

const rowOf = (section: ScoreboardSection, id: string): ScoreboardRow => {
  const row = section.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};

describe("buildCohortSection", () => {
  const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, PLANS, "base");

  it("emits 2N columns — one per plan per cohort — and flags the baseline", () => {
    expect(section.columns).toEqual([
      { planId: "base", planName: "Expert", cohort: "dp1", isBaseline: true },
      { planId: "base", planName: "Expert", cohort: "dp2", isBaseline: true },
      { planId: "other", planName: "Engine", cohort: "dp1", isBaseline: false },
      { planId: "other", planName: "Engine", cohort: "dp2", isBaseline: false },
    ]);
  });

  it("gives the baseline's own columns no delta — it is the reference, not a comparand", () => {
    const row = rowOf(section, "placementRows");

    expect(row.cells[0]).toEqual({ text: "2", delta: null, deltaText: null });
    expect(row.cells[1]).toEqual({ text: "0", delta: null, deltaText: null });
  });

  it("gives a numeric comparand cell a signed delta against the baseline's SAME cohort", () => {
    const row = rowOf(section, "placementRows");

    // Engine dp1 has 3 rows vs the baseline dp1's 2 — compared dp1-to-dp1, never dp1-to-dp2.
    expect(row.cells[2]).toEqual({ text: "3", delta: 1, deltaText: "+1" });
  });

  it("renders a negative delta with a true minus sign, never a hyphen", () => {
    const reversed = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [OTHER, BASE], "other");
    const row = rowOf(reversed, "placementRows");

    expect(row.cells[2]).toEqual({ text: "2", delta: -1, deltaText: "−1" });
  });

  it("keeps floating-point dust out of a delta — never `−0.5200000000000002`", () => {
    const { delta } = rowOf(section, "coursesPerSlot").cells[2];

    if (delta !== null) expect(delta).toBe(Math.round(delta * 100) / 100);
  });
});

describe("buildPlanSection", () => {
  const section = buildPlanSection("Board-wide", BOARD_WIDE, PLANS, "base");

  it("emits one column per plan", () => {
    expect(section.columns).toEqual([
      { planId: "base", planName: "Expert", isBaseline: true },
      { planId: "other", planName: "Engine", isBaseline: false },
    ]);
  });

  it("never puts a delta on a text row — an extreme is `Kowalski: 42`, not a number", () => {
    for (const id of ["worstTeacher", "worstStudent"]) {
      const row = rowOf(section, id);
      for (const cell of row.cells) {
        expect(cell).toMatchObject({ delta: null, deltaText: null });
      }
    }
  });

  it("never puts a delta on a cross-cohort ratio row", () => {
    const cross = buildPlanSection("Cross-cohort", CROSS_COHORT, PLANS, "base");

    for (const id of ["teachersBoth", "cohortPureTeacherDays", "seamlessSwitches"]) {
      for (const cell of rowOf(cross, id).cells) {
        expect(cell).toMatchObject({ delta: null, deltaText: null });
      }
    }
  });

  it("produces NO ranking, ordering, or better/worse verdict — only signed deltas", () => {
    const keys = new Set(Object.keys(section.rows[0].cells[0]));

    // A `rank`, `winner`, `better`, or `score` key here would be the scalar the analyzer exists to
    // avoid. The cell shape is the enforcement point.
    expect(keys).toEqual(new Set(["text", "delta", "deltaText"]));
    expect(section).not.toHaveProperty("winner");
    expect(section).not.toHaveProperty("ranking");
  });

  it("falls back to the first plan when the designated baseline id does not resolve", () => {
    const orphaned = buildPlanSection("Board-wide", BOARD_WIDE, PLANS, "does-not-exist");

    // No column claims to be the baseline, and deltas are computed against PLANS[0] rather than
    // silently against nothing.
    expect(orphaned.columns.every((column) => !column.isBaseline)).toBe(true);
    expect(rowOf(orphaned, "teacherGapSlots").cells[0]).toMatchObject({ delta: 0 });
  });
});
