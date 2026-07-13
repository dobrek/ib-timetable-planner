import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { CourseDeficit } from "../generation/types";
import type { CourseHours } from "../hours";
import type { BoardAvailabilityCell } from "../availability-index";

/**
 * The analyzer's own input/output shapes. Deliberately NOT `GeneratorSnapshot`: the extractor
 * measures any board (expert-authored or engine-generated) and needs subject identity for
 * roll-up labels and the mirrored-cell census — data the engine has no use for. Keeping the
 * projection here leaves `GroupingCourse` (and therefore the catalog hash) untouched.
 *
 * Reporting principle, validated by the manual v0 report: **distributions and worst cases, not
 * totals** — a mean over a complete board is a catalog constant and carries no placement signal.
 */

/** The grouping projection plus the subject identity the engine never needs (roll-ups, mirrored cells). */
export type AnalyzerCourse = GroupingCourse & {
  name: string;
  level: string;
  groupIndex: number;
};

/** One placed course-hour, cohort-tagged — structurally assignable from `GeneratedPlacement`
 *  and from a `placements` DB row projection, so both plan kinds reduce to this one shape. */
export type AnalyzerRow = {
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
};

/** Everything `analyzePlan` reads: the grid, both catalogs, the whole two-cohort board,
 *  plan-scoped teacher availability, and parked (shelved) coverage per cohort. */
export type PlanAnalysisInput = {
  days: number;
  periods: number;
  courses: Record<Cohort, AnalyzerCourse[]>;
  rows: AnalyzerRow[];
  availability: BoardAvailabilityCell[];
  parkedCourseIds: Record<Cohort, string[]>;
};

/** Per-cohort hour accounting — always rendered beside a slot count, because an incomplete board
 *  trivially uses fewer slots (the stale-bench trap).
 *
 *  The two totals stay **separate, never netted**: a course carrying more hours than the catalog
 *  asks for does not cancel another course's shortfall. That is not pedantry here — it is the whole
 *  finding. In the gold plan dp1's Chemistry runs as an overlap pair (a 2-hour HL dependent over a
 *  4-hour, zero-direct-enrolment SL base that the catalog projection drops), and the expert's six
 *  placed hours therefore read as +4 over-placed while the engine's two read as complete. Netting
 *  would have erased the very gap the comparison exists to expose. */
export type CompletenessFeatures = {
  unplacedHours: number;
  unplaced: CourseDeficit[];
  overplacedHours: number;
  overplaced: CourseHours[];
  /** Placed rows whose course is absent from the catalog projection — a row nobody can account for
   *  (a dropped overlap base, a stale course row). Zero on a healthy plan; a loud number otherwise. */
  uncataloguedRows: number;
};

/** Free/occupied profile of one day's used span (week-agnostic cells). */
export type DayEdgeProfile = {
  day: number;
  /** First/last occupied period; `null` on an empty day (nullable over sentinels). */
  first: number | null;
  last: number | null;
  span: number;
  occupied: number;
  freeAtStart: number;
  freeAtEnd: number;
  interiorHoles: number;
};

/** Board shape per cohort: the "packed mornings, short Friday" lens. */
export type BoardShapeFeatures = {
  occupiedSlots: number;
  placementRows: number;
  interiorHoles: number;
  freeSlotsAtDayStart: number;
  freeSlotsAtDayEnd: number;
  /**
   * Days with no lesson at all. An empty day has no span, so all of its periods count as
   * "before the first lesson" and land in `freeSlotsAtDayStart` — read the two together or an empty
   * Friday reads as a whole column of free mornings, which is the opposite of what that metric means.
   */
  emptyDays: number;
  days: DayEdgeProfile[];
};

/** How evenly the week carries its load (hours = placement rows; slots = distinct cells). */
export type DailyLoadFeatures = {
  hoursPerDay: number[];
  slotsPerDay: number[];
  hours: Distribution;
  slots: Distribution;
};

/** Where a thin slot sits inside its day's used span — the refinement that replaces
 *  "thin slots are bad": the expert's thin slots are deliberate edge doubles. */
export type SlotPosition = "start" | "end" | "interior";

export type ThinSlot = {
  day: number;
  period: number;
  students: number;
  position: SlotPosition;
};

/** Slot-census metrics — distinct `(day, period)` cells, counted week-agnostically. */
export type SlotCensusFeatures = {
  cohortStudents: number;
  studentsPerSlot: Distribution;
  coursesPerSlot: Distribution;
  /** Share of the cohort below which a slot counts as thin (0.25 = the report's convention). */
  thinSlotShare: number;
  thinSlots: ThinSlot[];
};

/** A-vs-B lane comparison: how symmetric the fortnight is. */
export type WeekSymmetryFeatures = {
  slotsWeekA: number;
  slotsWeekB: number;
  slotDelta: number;
  /** Cells whose course set differs between the A and B lanes. */
  differingCells: number;
};

/** The headline course-lens findings: doubles vs same-day splits (lane-expanded). */
export type CourseAdjacencyFeatures = {
  adjacentPairs: number;
  sameDaySplits: number;
  /** Ids of the courses carrying at least one split — the anti-pattern's offender list. */
  splitCourseIds: string[];
};

export type CourseTimeOfDay = {
  courseId: string;
  meanPeriod: number;
};

/** How a course's hours spread across the week (the adjacency-vs-spread tension, measurable). */
export type CourseSpreadFeatures = {
  placedCourses: number;
  multiDayCourses: number;
  daysUsed: Distribution;
  meanPeriodByCourse: CourseTimeOfDay[];
};

/** The tier-4 lens: distributions and worst cases, because fairness is never a question about the mean. */
export type StudentFeatures = {
  students: number;
  /** Lane-expanded span − occupancy, summed — the same number `countStudentHoles` returns. */
  gapSlots: number;
  gapsPerStudent: Distribution;
  worstStudentGaps: Extreme | null;
  hoursPerStudentDay: Distribution;
  /** hours ÷ span per student-day-week; 1.0 is a fully compact day. */
  spanEfficiency: Distribution;
  maxConsecutiveHours: Distribution;
  /** Student-day-weeks holding exactly one lesson — the classic real-world irritant. */
  singleLessonDays: number;
  earlyStarts: Distribution;
  lateFinishes: Distribution;
  daysOnCampus: Distribution;
};

/** The lens the objective is entirely missing: teacher compactness across BOTH cohorts. */
export type TeacherFeatures = {
  teachers: number;
  gapSlots: number;
  gapsPerTeacher: Distribution;
  worstTeacherGaps: Extreme | null;
  teachingDays: Distribution;
  hoursPerTeachingDay: Distribution;
  daySpan: Distribution;
  maxConsecutiveTeaching: Distribution;
  /** Placements on a teacher's soft-`no` cells — the localization of verify's `softWarnCount`. */
  softAvailabilityHits: number;
  strongAvailabilityHits: number;
  softHitsByTeacher: Extreme[];
};

/** One teacher's hours on one day of one week, in period order and cohort-tagged — the sequence
 *  the switch metrics read. */
export type TeacherDaySequence = {
  teacher: string;
  day: number;
  weekLane: "a" | "b";
  hours: { period: number; cohort: Cohort }[];
};

/** A cell running the same subject in both cohorts — a school fixture, until proven otherwise. */
export type MirroredCell = {
  name: string;
  level: string;
  day: number;
  period: number;
  courseIds: Record<Cohort, string>;
};

/** How the two cohorts are woven together — one staffing system, not two grids. */
export type CrossCohortFeatures = {
  teachers: number;
  teachersInBothCohorts: number;
  teacherDays: number;
  cohortPureTeacherDays: number;
  cohortPureShare: number;
  cohortSwitches: number;
  /** Switches taken back-to-back (adjacent periods) rather than across an idle gap. */
  seamlessSwitches: number;
  seamlessShare: number;
  sharedSubjectEditionDays: number;
  /** The automatic fixture detector's output. */
  mirroredCells: MirroredCell[];
};

/** Course-grain numbers rolled up to a subject — chiefly the expert's time-of-day gradient. */
export type SubjectRollup = {
  subject: string;
  courses: number;
  placedHours: number;
  meanPeriod: number;
  adjacentPairs: number;
  sameDaySplits: number;
};

/** Everything measured within one cohort's grid. */
export type CohortFeatures = {
  completeness: CompletenessFeatures;
  board: BoardShapeFeatures;
  dailyLoad: DailyLoadFeatures;
  slotCensus: SlotCensusFeatures;
  weekSymmetry: WeekSymmetryFeatures;
  adjacency: CourseAdjacencyFeatures;
  spread: CourseSpreadFeatures;
  students: StudentFeatures;
};

/** The v1 feature vector — never scalarized into a score (the weighted-scalar tier-bleed lesson):
 *  the analyzer reports, the human (and later the objective) judges. Teachers, cross-cohort structure
 *  and subject roll-ups are board-wide: staff and subjects span both cohorts. */
export type PlanQualityFeatures = {
  days: number;
  periods: number;
  cohorts: Record<Cohort, CohortFeatures>;
  teachers: TeacherFeatures;
  crossCohort: CrossCohortFeatures;
  subjects: SubjectRollup[];
};

/** Summary of a value set — the shape every "report the distribution, not the total" metric returns. */
export type Distribution = {
  count: number;
  min: number;
  p10: number;
  median: number;
  mean: number;
  max: number;
  variance: number;
};

/** The worst (largest) entry of a keyed metric — the fairness lens's "who eats the bad slots". */
export type Extreme = {
  key: string;
  value: number;
};
