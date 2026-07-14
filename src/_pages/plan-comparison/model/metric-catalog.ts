import type { Cohort } from "@/shared/config";
import type { PlanQualityFeatures } from "@/entities/timetable";
import { num, pct, pooledMean, sumCohorts } from "./format";
import { worstStudentCell, worstTeacherCell, type MetricCell, type PlanContext } from "./extremes";

/**
 * The five metric catalogs, ported row-for-row from `bench/plan-report.ts`.
 *
 * The bench's `console.log` renderer is not reusable as code, but its declarative `rows: [label, fn][]`
 * arrays ARE a ready-made spec: they encode exactly which metrics matter, in what order, with what
 * labels — validated against the expert board in analyzer run #1. Port the catalogs; leave the
 * printing behind.
 *
 * A row is a typed `MetricRow`, not a tuple, so it carries a stable `id` and reads its own value. Every
 * row formats to a **`MetricCell`** — a finished string, exactly as the bench prints it, plus an optional
 * link. It exposes no number, so nothing downstream *can* subtract one row from another; and several are
 * not numbers anyway (`"Ada Byron: 42"`, or ratios like `"12 / 17"`).
 *
 * It reports; it never judges. No pass/fail bar, no ranking, no composite score, no baseline-relative
 * delta — each would smuggle back the scalar the analyzer exists to avoid (the weighted-scalar
 * tier-bleed bug).
 */

/** A row read per (plan, cohort) — the cohort-grain sections. */
export type CohortMetricRow = {
  /** Stable identity, so a row can be addressed without matching on its label. */
  id: string;
  label: string;
  read: (features: PlanQualityFeatures, cohort: Cohort) => MetricCell;
};

/**
 * A row read per plan — the board-wide sections.
 *
 * `plan` is passed to every row but used by only two: the worst-teacher and worst-student rows need the
 * plan's id and names to turn the analyzer's key into a named link. Rows that ignore it simply declare
 * fewer parameters.
 */
export type PlanMetricRow = {
  id: string;
  label: string;
  read: (features: PlanQualityFeatures, plan: PlanContext) => MetricCell;
};

/** A finished value with nowhere to go — the shape of all but two rows. */
const text = (value: string): MetricCell => ({ text: value });

const cohortOf = (features: PlanQualityFeatures, cohort: Cohort) => features.cohorts[cohort];

const goldenOf = (features: PlanQualityFeatures, cohort: Cohort) => cohortOf(features, cohort).slotCensus.goldenCensus;

/** A numeric cohort row — the common case: read the number, render it the way the bench does. */
const cohortNumber = (
  id: string,
  label: string,
  value: (features: PlanQualityFeatures, cohort: Cohort) => number,
): CohortMetricRow => ({ id, label, read: (f, c) => text(num(value(f, c))) });

const planNumber = (id: string, label: string, value: (features: PlanQualityFeatures) => number): PlanMetricRow => ({
  id,
  label,
  read: (f) => text(num(value(f))),
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
 * (`≤{pct(missShare)} missing`) are read off a census rather than hardcoded. Both are analyzer
 * *settings* echoed back by every plan, not per-plan findings — so any plan's census can name them,
 * and taking the first one privileges nothing. (The bench reads them off `reports[0]` for the same
 * reason.)
 */
export const goldenCensusRows = (sample: PlanQualityFeatures, cohort: Cohort): CohortMetricRow[] => {
  const { band, missShare } = sample.cohorts[cohort].slotCensus.goldenCensus;
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

      read: (f, c) => text(`${String(goldenOf(f, c).goldenInBand)} / ${String(goldenOf(f, c).golden.length)}`),
    },
    {
      id: "goldenBandShare",
      label: "— band share",
      read: (f, c) => text(pct(goldenOf(f, c).bandShare)),
    },
  ];
};

/** Board-wide (both cohorts) — 12 rows, `bench/plan-report.ts:159-178`. */
export const BOARD_WIDE: PlanMetricRow[] = [
  planNumber("teacherGapSlots", "TEACHER gap-slots", (f) => f.teachers.gapSlots),
  // The two rows that name a person — and the only two that link. See `extremes.ts`.
  { id: "worstTeacher", label: "Worst teacher (gaps)", read: worstTeacherCell },
  planNumber("teachingDays", "Avg teaching days / teacher", (f) => f.teachers.teachingDays.mean),
  planNumber("hoursPerTeachingDay", "Avg hours / teaching day", (f) => f.teachers.hoursPerTeachingDay.mean),
  planNumber("maxConsecutiveTeaching", "Max consecutive teaching", (f) => f.teachers.maxConsecutiveTeaching.max),
  planNumber("softAvailabilityHits", "Soft-availability hits", (f) => f.teachers.softAvailabilityHits),
  planNumber("strongAvailabilityHits", "Strong-availability hits", (f) => f.teachers.strongAvailabilityHits),
  planNumber("studentGapSlotsTotal", "Student gap-slots", (f) => sumCohorts(f, (cohort) => cohort.students.gapSlots)),
  { id: "worstStudent", label: "Worst student (gaps)", read: worstStudentCell },
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

/** Cross-cohort weave — 6 rows, `bench/plan-report.ts:200-217`. Three are ratio strings — one more
 *  reason nothing here is subtracted. */
export const CROSS_COHORT: PlanMetricRow[] = [
  {
    id: "teachersBoth",
    label: "Teachers (both cohorts / all)",
    read: (f) => text(`${String(f.crossCohort.teachersInBothCohorts)} / ${String(f.crossCohort.teachers)}`),
  },
  {
    id: "cohortPureTeacherDays",
    label: "Cohort-pure teacher-days",
    read: (f) =>
      text(
        `${String(f.crossCohort.cohortPureTeacherDays)} / ${String(f.crossCohort.teacherDays)} (${pct(f.crossCohort.cohortPureShare)})`,
      ),
  },
  planNumber("cohortSwitches", "Cohort switches (within a day)", (f) => f.crossCohort.cohortSwitches),
  {
    id: "seamlessSwitches",
    label: "— of which seamless",
    read: (f) => text(`${String(f.crossCohort.seamlessSwitches)} (${pct(f.crossCohort.seamlessShare)})`),
  },
  planNumber("sharedSubjectEditionDays", "Shared subject-edition days", (f) => f.crossCohort.sharedSubjectEditionDays),
  planNumber("mirroredCells", "Mirrored cells (fixtures)", (f) => f.crossCohort.mirroredCells.length),
];
