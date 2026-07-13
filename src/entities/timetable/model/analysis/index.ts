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
export { deriveStudentLens } from "./student-lens";
export { deriveTeacherLens } from "./teacher-lens";
export { deriveCrossCohort } from "./cross-cohort";
export { deriveSubjectRollup, subjectByName } from "./subject-rollup";
export type {
  AnalyzerCourse,
  AnalyzerRow,
  BoardShapeFeatures,
  CohortFeatures,
  CompletenessFeatures,
  CourseAdjacencyFeatures,
  CourseSpreadFeatures,
  CourseTimeOfDay,
  CrossCohortFeatures,
  DailyLoadFeatures,
  DayEdgeProfile,
  Distribution,
  Extreme,
  MirroredCell,
  PlanAnalysisInput,
  PlanQualityFeatures,
  SlotCensusFeatures,
  SlotPosition,
  StudentFeatures,
  SubjectRollup,
  TeacherDaySequence,
  TeacherFeatures,
  ThinSlot,
  WeekSymmetryFeatures,
} from "./types";
