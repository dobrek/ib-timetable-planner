import { describe, expect, it } from "vitest";
import { analyzePlan, type PlanQualityFeatures } from "@/entities/timetable";
import { BOARD_WIDE, COHORT_SCOREBOARD, CROSS_COHORT, goldenCensusRows } from "./metric-catalog";
import { buildLoadedPlan, SAMPLE } from "./__fixtures__/loaded-plan";

const features: PlanQualityFeatures = analyzePlan(
  buildLoadedPlan({
    ...SAMPLE,
    rows: [
      { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
      { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 2, week: "both" },
      { cohort: "dp1", courseId: "p1-c-1", day: 2, period: 3, week: "both" },
      { cohort: "dp2", courseId: "p1-c-2", day: 3, period: 4, week: "both" },
    ],
  }).input,
);

/**
 * The row labels, in order, exactly as `bench/plan-report.ts` declares them. Transcribed rather than
 * imported: the bench is the *spec* this catalog was ported from, so a divergence must fail loudly
 * here — and importing the bench's private arrays would defeat the point (they aren't exported, and a
 * shared constant could drift in lockstep without anyone noticing).
 */
const BENCH_COHORT_LABELS = [
  "UNPLACED HOURS",
  "OVER-PLACED HOURS",
  "Uncatalogued rows",
  "Occupied slots",
  "Placement rows",
  "Interior holes",
  "Free at day START",
  "Free at day END",
  "— of which EMPTY days",
  "Same-course adjacent pairs",
  "Same-course same-day SPLITS",
  "Students/slot median",
  "Thin slots (≤25% cohort)",
  "Courses/slot avg",
  "Multi-day courses",
  "Student gap-slots",
  "Single-lesson student-days",
  "Week A/B slot delta",
];

const BENCH_BOARD_WIDE_LABELS = [
  "TEACHER gap-slots",
  "Worst teacher (gaps)",
  "Avg teaching days / teacher",
  "Avg hours / teaching day",
  "Max consecutive teaching",
  "Soft-availability hits",
  "Strong-availability hits",
  "Student gap-slots",
  "Worst student (gaps)",
  "Avg hours / student-day",
  "Single-lesson student-days",
  "Unplaced hours (total)",
];

const BENCH_CROSS_COHORT_LABELS = [
  "Teachers (both cohorts / all)",
  "Cohort-pure teacher-days",
  "Cohort switches (within a day)",
  "— of which seamless",
  "Shared subject-edition days",
  "Mirrored cells (fixtures)",
];

describe("metric catalog", () => {
  it("matches the bench's cohort scoreboard row count and order", () => {
    expect(COHORT_SCOREBOARD.map((row) => row.label)).toEqual(BENCH_COHORT_LABELS);
  });

  it("matches the bench's board-wide row count and order", () => {
    expect(BOARD_WIDE.map((row) => row.label)).toEqual(BENCH_BOARD_WIDE_LABELS);
  });

  it("matches the bench's cross-cohort row count and order", () => {
    expect(CROSS_COHORT.map((row) => row.label)).toEqual(BENCH_CROSS_COHORT_LABELS);
  });

  // The invariant that empty days sit directly beneath the day-edge rows (impl-review F8): a wholly
  // empty day pours all its periods into `freeSlotsAtDayStart`, so read apart it reads as a column of
  // free mornings — the opposite of what the metric means.
  it("keeps `— of which EMPTY days` directly beneath the two day-edge rows", () => {
    const labels = COHORT_SCOREBOARD.map((row) => row.label);
    const end = labels.indexOf("Free at day END");

    expect(labels[end - 1]).toBe("Free at day START");
    expect(labels[end + 1]).toBe("— of which EMPTY days");
  });

  it("has six golden-census rows, with the band and near-golden labels read off the BASELINE", () => {
    const rows = goldenCensusRows(features, "dp1");

    expect(rows).toHaveLength(6);
    const { band, missShare } = features.cohorts.dp1.slotCensus.goldenCensus;
    expect(rows[2].label).toBe(`Near-golden cells (≤${String(Math.round(missShare * 100))}% missing)`);
    expect(rows[4].label).toBe(`Golden inside the mid-day band (P${String(band.first)}–P${String(band.last)})`);
  });

  it("resolves every row against a real feature vector without throwing", () => {
    for (const row of COHORT_SCOREBOARD) {
      expect(typeof row.read(features, "dp1")).toBe("string");
      expect(typeof row.read(features, "dp2")).toBe("string");
    }
    for (const row of [...BOARD_WIDE, ...CROSS_COHORT]) {
      expect(typeof row.read(features)).toBe("string");
    }
    for (const row of goldenCensusRows(features, "dp1")) {
      expect(typeof row.read(features, "dp1")).toBe("string");
    }
  });

  it("marks ratio and extreme rows as `text`, so no delta is ever subtracted from them", () => {
    // "12 / 17" and "Kowalski: 42" are not numbers; a delta over them would be nonsense.
    expect(BOARD_WIDE.find((row) => row.id === "worstTeacher")?.kind).toBe("text");
    expect(BOARD_WIDE.find((row) => row.id === "worstStudent")?.kind).toBe("text");
    expect(CROSS_COHORT.find((row) => row.id === "teachersBoth")?.kind).toBe("text");
    expect(CROSS_COHORT.find((row) => row.id === "seamlessSwitches")?.kind).toBe("text");
    expect(goldenCensusRows(features, "dp1").find((row) => row.id === "goldenInBand")?.kind).toBe("text");
  });

  it("gives every `number` row a value reader, and every `text` row none", () => {
    const all = [...COHORT_SCOREBOARD, ...BOARD_WIDE, ...CROSS_COHORT, ...goldenCensusRows(features, "dp1")];

    for (const row of all) {
      if (row.kind === "number") expect(row.value, `${row.id} is numeric but has no value reader`).toBeDefined();
      else expect(row.value, `${row.id} is text but carries a value reader`).toBeUndefined();
    }
  });
});
