export { analyzePlan, ANALYZED_COHORTS } from "./analyze-plan";
export { expandLanes, laneStats, lanesOf, type Lane, type LaneStats, type WeekLane } from "./lanes";
export { distribution, worstOf } from "./stats";
export { deriveCompleteness } from "./completeness";
export { deriveBoardShape } from "./board-shape";
export { deriveDailyLoad } from "./daily-load";
export { deriveSlotCensus, THIN_SLOT_SHARE } from "./slot-census";
export { deriveWeekSymmetry } from "./week-symmetry";
export { deriveCourseAdjacency } from "./course-adjacency";
export { deriveCourseSpread } from "./course-spread";
export type {
  AnalyzerCourse,
  AnalyzerRow,
  BoardShapeFeatures,
  CohortFeatures,
  CompletenessFeatures,
  CourseAdjacencyFeatures,
  CourseSpreadFeatures,
  CourseTimeOfDay,
  DailyLoadFeatures,
  DayEdgeProfile,
  Distribution,
  Extreme,
  PlanAnalysisInput,
  PlanQualityFeatures,
  SlotCensusFeatures,
  SlotPosition,
  ThinSlot,
  WeekSymmetryFeatures,
} from "./types";
