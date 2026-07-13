import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { CourseDeficit } from "../generation/types";
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

/** Per-cohort unplaced hours — always rendered beside a slot count, because an incomplete
 *  board trivially uses fewer slots (the stale-bench trap). */
export type CompletenessFeatures = {
  unplacedHours: number;
  unplaced: CourseDeficit[];
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

/** Everything measured within one cohort's grid. */
export type CohortFeatures = {
  completeness: CompletenessFeatures;
  board: BoardShapeFeatures;
  dailyLoad: DailyLoadFeatures;
  slotCensus: SlotCensusFeatures;
  weekSymmetry: WeekSymmetryFeatures;
  adjacency: CourseAdjacencyFeatures;
  spread: CourseSpreadFeatures;
};

/** The v1 feature vector — never scalarized into a score (the weighted-scalar tier-bleed lesson):
 *  the analyzer reports, the human (and later the objective) judges. */
export type PlanQualityFeatures = {
  days: number;
  periods: number;
  cohorts: Record<Cohort, CohortFeatures>;
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
