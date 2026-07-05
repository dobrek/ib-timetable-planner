import type { Cohort } from "@/shared/config";
import { type CourseDisplay, type PlannerPlacement, projectFromPlacements } from "@/entities/timetable";
import type { PlannerBoardProps } from "../drag";
import type { GroupingCourse, PlannerGrouping } from "../grouping/grouping";
import type { ParkedBundle } from "../placement/parked";

/** One cohort's already-loaded, domain-mapped board data — the per-column half the assembler pairs. */
export type CombinedCohortInputs = {
  cohort: Cohort;
  groupings: PlannerGrouping[];
  placements: PlannerPlacement[];
  catalog: GroupingCourse[];
  /** courseId → display data (name + optional color) for *this* cohort's catalog. */
  courseDisplay: Record<string, CourseDisplay>;
  /** studentKey → full name for this cohort's catalog enrollments. */
  studentNames: Record<string, string>;
  stale: boolean;
  parkedBundles: ParkedBundle[];
};

export type CombinedAssemblyInputs = {
  dp1: CombinedCohortInputs;
  dp2: CombinedCohortInputs;
};

/**
 * Pair two cohorts' loaded data into two fully-editable `PlannerBoardProps`, each carrying a
 * cross-cohort occupancy index **derived from the other column's placements** (the live two-cohort
 * seam — S-06). This is the pure half of `loadCombinedPlannerData`: it does no IO, so the loader
 * stays a thin row-mapper and this assembly is unit-tested directly. Plan-scoped fields (grid,
 * availability, union teacher names) live in `SharedBoardProps` and are assembled separately by the loader;
 * groupings, placements, catalog, own-cohort names, student names, stale, and parked bundles stay per-cohort.
 */
export const assembleCombinedProps = (
  inputs: CombinedAssemblyInputs,
): { dp1: PlannerBoardProps; dp2: PlannerBoardProps } => ({
  dp1: buildColumn(inputs.dp1, inputs.dp2),
  dp2: buildColumn(inputs.dp2, inputs.dp1),
});

const buildColumn = (own: CombinedCohortInputs, other: CombinedCohortInputs): PlannerBoardProps => ({
  cohort: own.cohort,
  groupings: own.groupings,
  stale: own.stale,
  courseDisplay: own.courseDisplay,
  studentNames: own.studentNames,
  placements: own.placements,
  catalog: own.catalog,
  crossCohortOccupancy: projectFromPlacements(
    other.placements.map((placement) => ({
      courseId: placement.courseId,
      day: placement.day,
      period: placement.period,
      week: placement.week,
    })),
    new Map(other.catalog.map((course) => [course.id, course.teacherKeys])),
  ),
  parkedBundles: own.parkedBundles,
});
