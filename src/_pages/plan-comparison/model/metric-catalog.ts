import type { Cohort } from "@/shared/config";
import type { PlanQualityFeatures } from "@/entities/timetable";
import { extreme, num, pct, pooledMean, sumCohorts, worstStudent } from "./format";

/**
 * The five metric catalogs, ported row-for-row from `bench/plan-report.ts`.
 *
 * The bench's `console.log` renderer is not reusable as code, but its declarative `rows: [label, fn][]`
 * arrays ARE a ready-made spec: they encode exactly which metrics matter, in what order, with what
 * labels — validated against the expert board in analyzer run #1. Port the catalogs; leave the
 * printing behind.
 *
 * A row is a typed `MetricRow`, not a tuple, because it must carry a **`kind`**: numeric rows get a
 * baseline-relative delta, text rows must not (`extreme` yields `"Kowalski: 42"`, and several
 * cross-cohort rows are ratios like `"12 / 17"` — subtracting those is meaningless).
 *
 * It reports; it never judges. No pass/fail bar, no ranking, no composite score — that would smuggle
 * back the scalar the analyzer exists to avoid (the weighted-scalar tier-bleed bug).
 */

/** A row read per (plan, cohort) — the cohort-grain sections. */
export type CohortMetricRow = {
  /** Stable identity, so a delta can be attached to a row without matching on its label. */
  id: string;
  label: string;
  kind: MetricKind;
  read: (features: PlanQualityFeatures, cohort: Cohort) => string;
  /** The numeric value a delta is computed from. Absent on text rows. */
  value?: (features: PlanQualityFeatures, cohort: Cohort) => number;
};

/** A row read per plan — the board-wide sections. */
export type PlanMetricRow = {
  id: string;
  label: string;
  kind: MetricKind;
  read: (features: PlanQualityFeatures) => string;
  value?: (features: PlanQualityFeatures) => number;
};

/** `number` rows get a signed delta vs the baseline; `text` rows never do. */
export type MetricKind = "number" | "text";

const cohortOf = (features: PlanQualityFeatures, cohort: Cohort) => features.cohorts[cohort];

const goldenOf = (features: PlanQualityFeatures, cohort: Cohort) => cohortOf(features, cohort).slotCensus.goldenCensus;

/** A numeric cohort row — the common case: render with `num`, delta off the same number. */
const cohortNumber = (
  id: string,
  label: string,
  value: (features: PlanQualityFeatures, cohort: Cohort) => number,
): CohortMetricRow => ({ id, label, kind: "number", read: (f, c) => num(value(f, c)), value });

const planNumber = (id: string, label: string, value: (features: PlanQualityFeatures) => number): PlanMetricRow => ({
  id,
  label,
  kind: "number",
  read: (f) => num(value(f)),
  value,
});

/**
 * Cohort scoreboard — 18 rows, `bench/plan-report.ts:65-90`.
 *
 * Row order is load-bearing, not cosmetic. `— of which EMPTY days` sits directly beneath the two
 * day-edge rows because a wholly empty day has no span, so ALL of its periods land in
 * `freeSlotsAtDayStart` — read apart, an empty Friday reads as a column of free mornings, which is the
 * opposite of what that metric means (impl-review F8).
 */
export const COHORT_SCOREBOARD: CohortMetricRow[] = [
  cohortNumber("unplacedHours", "UNPLACED HOURS", (f, c) => cohortOf(f, c).completeness.unplacedHours),
  cohortNumber("overplacedHours", "OVER-PLACED HOURS", (f, c) => cohortOf(f, c).completeness.overplacedHours),
  cohortNumber("uncataloguedRows", "Uncatalogued rows", (f, c) => cohortOf(f, c).completeness.uncataloguedRows),
  cohortNumber("occupiedSlots", "Occupied slots", (f, c) => cohortOf(f, c).board.occupiedSlots),
  cohortNumber("placementRows", "Placement rows", (f, c) => cohortOf(f, c).board.placementRows),
  cohortNumber("interiorHoles", "Interior holes", (f, c) => cohortOf(f, c).board.interiorHoles),
  cohortNumber("freeAtDayStart", "Free at day START", (f, c) => cohortOf(f, c).board.freeSlotsAtDayStart),
  cohortNumber("freeAtDayEnd", "Free at day END", (f, c) => cohortOf(f, c).board.freeSlotsAtDayEnd),
  cohortNumber("emptyDays", "— of which EMPTY days", (f, c) => cohortOf(f, c).board.emptyDays),
  cohortNumber("adjacentPairs", "Same-course adjacent pairs", (f, c) => cohortOf(f, c).adjacency.adjacentPairs),
  cohortNumber("sameDaySplits", "Same-course same-day SPLITS", (f, c) => cohortOf(f, c).adjacency.sameDaySplits),
  cohortNumber("studentsPerSlot", "Students/slot median", (f, c) => cohortOf(f, c).slotCensus.studentsPerSlot.median),
  cohortNumber("thinSlots", "Thin slots (≤25% cohort)", (f, c) => cohortOf(f, c).slotCensus.thinSlots.length),
  cohortNumber("coursesPerSlot", "Courses/slot avg", (f, c) => cohortOf(f, c).slotCensus.coursesPerSlot.mean),
  cohortNumber("multiDayCourses", "Multi-day courses", (f, c) => cohortOf(f, c).spread.multiDayCourses),
  cohortNumber("studentGapSlots", "Student gap-slots", (f, c) => cohortOf(f, c).students.gapSlots),
  cohortNumber("singleLessonDays", "Single-lesson student-days", (f, c) => cohortOf(f, c).students.singleLessonDays),
  cohortNumber("weekSlotDelta", "Week A/B slot delta", (f, c) => cohortOf(f, c).weekSymmetry.slotDelta),
];

/**
 * Golden slots — 6 rows, `bench/plan-report.ts:133-146`.
 *
 * Two labels are **dynamic**: the mid-day band (`P{first}–P{last}`) and the near-golden threshold
 * (`≤{pct(missShare)} missing`) are read off the baseline's own census, so they are functions of the
 * baseline rather than constants.
 */
export const goldenCensusRows = (baseline: PlanQualityFeatures, firstCohort: Cohort): CohortMetricRow[] => {
  const { band, missShare } = baseline.cohorts[firstCohort].slotCensus.goldenCensus;
  return [
    cohortNumber("goldenCells", "Golden cells", (f, c) => goldenOf(f, c).golden.length),
    cohortNumber("goldenComposites", "— of which composite (3+ courses)", (f, c) => goldenOf(f, c).composites),
    cohortNumber(
      "nearGolden",
      `Near-golden cells (≤${pct(missShare)} missing)`,
      (f, c) => goldenOf(f, c).nearGolden.length,
    ),
    cohortNumber("goldenMeanPeriod", "MEAN PERIOD of golden cells", (f, c) => goldenOf(f, c).meanPeriod),
    {
      id: "goldenInBand",
      label: `Golden inside the mid-day band (P${String(band.first)}–P${String(band.last)})`,
      // A ratio — `12 / 17`. Subtracting two ratios is meaningless, so no delta.
      kind: "text",
      read: (f, c) => `${String(goldenOf(f, c).goldenInBand)} / ${String(goldenOf(f, c).golden.length)}`,
    },
    {
      id: "goldenBandShare",
      label: "— band share",
      kind: "number",
      read: (f, c) => pct(goldenOf(f, c).bandShare),
      value: (f, c) => goldenOf(f, c).bandShare,
    },
  ];
};

/** Board-wide (both cohorts) — 12 rows, `bench/plan-report.ts:159-178`. */
export const BOARD_WIDE: PlanMetricRow[] = [
  planNumber("teacherGapSlots", "TEACHER gap-slots", (f) => f.teachers.gapSlots),
  {
    id: "worstTeacher",
    label: "Worst teacher (gaps)",
    kind: "text",
    read: (f) => extreme(f.teachers.worstTeacherGaps),
  },
  planNumber("teachingDays", "Avg teaching days / teacher", (f) => f.teachers.teachingDays.mean),
  planNumber("hoursPerTeachingDay", "Avg hours / teaching day", (f) => f.teachers.hoursPerTeachingDay.mean),
  planNumber("maxConsecutiveTeaching", "Max consecutive teaching", (f) => f.teachers.maxConsecutiveTeaching.max),
  planNumber("softAvailabilityHits", "Soft-availability hits", (f) => f.teachers.softAvailabilityHits),
  planNumber("strongAvailabilityHits", "Strong-availability hits", (f) => f.teachers.strongAvailabilityHits),
  planNumber("studentGapSlotsTotal", "Student gap-slots", (f) => sumCohorts(f, (cohort) => cohort.students.gapSlots)),
  { id: "worstStudent", label: "Worst student (gaps)", kind: "text", read: worstStudent },
  planNumber("hoursPerStudentDay", "Avg hours / student-day", (f) =>
    pooledMean(f, (cohort) => cohort.students.hoursPerStudentDay),
  ),
  planNumber("singleLessonDaysTotal", "Single-lesson student-days", (f) =>
    sumCohorts(f, (cohort) => cohort.students.singleLessonDays),
  ),
  planNumber("unplacedHoursTotal", "Unplaced hours (total)", (f) =>
    sumCohorts(f, (cohort) => cohort.completeness.unplacedHours),
  ),
];

/** Cross-cohort weave — 6 rows, `bench/plan-report.ts:200-217`. Three are ratio strings, so only
 *  three carry a delta. */
export const CROSS_COHORT: PlanMetricRow[] = [
  {
    id: "teachersBoth",
    label: "Teachers (both cohorts / all)",
    kind: "text",
    read: (f) => `${String(f.crossCohort.teachersInBothCohorts)} / ${String(f.crossCohort.teachers)}`,
  },
  {
    id: "cohortPureTeacherDays",
    label: "Cohort-pure teacher-days",
    kind: "text",
    read: (f) =>
      `${String(f.crossCohort.cohortPureTeacherDays)} / ${String(f.crossCohort.teacherDays)} (${pct(f.crossCohort.cohortPureShare)})`,
  },
  planNumber("cohortSwitches", "Cohort switches (within a day)", (f) => f.crossCohort.cohortSwitches),
  {
    id: "seamlessSwitches",
    label: "— of which seamless",
    kind: "text",
    read: (f) => `${String(f.crossCohort.seamlessSwitches)} (${pct(f.crossCohort.seamlessShare)})`,
  },
  planNumber("sharedSubjectEditionDays", "Shared subject-edition days", (f) => f.crossCohort.sharedSubjectEditionDays),
  planNumber("mirroredCells", "Mirrored cells (fixtures)", (f) => f.crossCohort.mirroredCells.length),
];
