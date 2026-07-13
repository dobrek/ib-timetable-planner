import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { deriveBoardShape } from "./board-shape";
import { deriveCompleteness } from "./completeness";
import { deriveCourseAdjacency } from "./course-adjacency";
import { deriveCourseSpread } from "./course-spread";
import { deriveCrossCohort } from "./cross-cohort";
import { deriveDailyLoad } from "./daily-load";
import { deriveSlotCensus } from "./slot-census";
import { deriveStudentLens } from "./student-lens";
import { deriveSubjectRollup } from "./subject-rollup";
import { deriveTeacherLens } from "./teacher-lens";
import { deriveWeekSymmetry } from "./week-symmetry";
import type { AnalyzerCourse, AnalyzerRow, CohortFeatures, PlanAnalysisInput, PlanQualityFeatures } from "./types";

/**
 * The plan-quality extractor: any board (expert-authored or engine-generated) in, a feature vector
 * out. Pure and Workers-safe like the rest of the entity core, so a future in-app surface reuses it
 * verbatim.
 *
 * It is a **feature vector, never a score**. The weighted-scalar objective this codebase already
 * replaced (a studentHoles term in the hundreds outvoting a whole slot) is the cautionary tale:
 * collapsing these numbers into one figure of merit hides exactly the dimensions the comparison
 * exists to expose. `analyzePlan` reports; the reader — and later, an evidence-led objective — judges.
 */
export const analyzePlan = (input: PlanAnalysisInput): PlanQualityFeatures => {
  // Teachers, subjects and the cohort weave are board-wide lenses: staff work both cohorts and a
  // subject has an edition in each, so they read the merged catalog rather than a per-cohort slice.
  const allCourses = allCoursesOf(input);
  return {
    days: input.days,
    periods: input.periods,
    cohorts: {
      dp1: cohortFeatures(input, "dp1"),
      dp2: cohortFeatures(input, "dp2"),
    },
    teachers: deriveTeacherLens(allCourses, input.rows, input.availability),
    crossCohort: deriveCrossCohort(input.courses, input.rows),
    subjects: deriveSubjectRollup(allCourses, input.rows),
  };
};

const cohortFeatures = (input: PlanAnalysisInput, cohort: Cohort): CohortFeatures => {
  const courses = input.courses[cohort];
  const rows = rowsOf(input, cohort);
  return {
    completeness: deriveCompleteness(rows, courses, input.parkedCourseIds[cohort]),
    board: deriveBoardShape(rows, input.days, input.periods),
    dailyLoad: deriveDailyLoad(rows, input.days),
    slotCensus: deriveSlotCensus(courses, rows),
    weekSymmetry: deriveWeekSymmetry(rows),
    adjacency: deriveCourseAdjacency(rows),
    spread: deriveCourseSpread(rows),
    students: deriveStudentLens(courses, rows, input.periods),
  };
};

const rowsOf = (input: PlanAnalysisInput, cohort: Cohort): AnalyzerRow[] =>
  input.rows.filter((row) => row.cohort === cohort);

const allCoursesOf = (input: PlanAnalysisInput): AnalyzerCourse[] =>
  COHORT_VALUES.flatMap((cohort) => input.courses[cohort]);
