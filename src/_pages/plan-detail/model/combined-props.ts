import type { Cohort } from "@/shared/config";
import type { BoardAvailabilityCell } from "./availability-index";
import { projectFromPlacements } from "./cross-cohort-index";
import type { PlannerBoardProps } from "./drag";
import type { GroupingCourse, PlannerGrouping } from "./grouping";
import type { ParkedBundle } from "./parked";
import type { PlannerPlacement } from "./placement";

/** One cohort's already-loaded, domain-mapped board data — the per-column half the assembler pairs. */
export type CombinedCohortInputs = {
  cohort: Cohort;
  groupings: PlannerGrouping[];
  placements: PlannerPlacement[];
  catalog: GroupingCourse[];
  /** courseId → display name for *this* cohort's catalog. */
  names: Record<string, string>;
  stale: boolean;
  parkedBundles: ParkedBundle[];
};

export type CombinedAssemblyInputs = {
  planId: string;
  days: number;
  periods: number;
  /** Plan-scoped, cohort-independent availability — shared by both columns. */
  availability: BoardAvailabilityCell[];
  /** teacherKey → name, resolved from the **union** of both catalogs (a cross-cohort clash names the sibling's teacher). */
  teacherNames: Record<string, string>;
  /** studentKey → name, resolved from the union of both catalogs. */
  studentNames: Record<string, string>;
  dp1: CombinedCohortInputs;
  dp2: CombinedCohortInputs;
};

/**
 * Pair two cohorts' loaded data into two fully-editable `PlannerBoardProps`, each carrying a
 * cross-cohort occupancy index **derived from the other column's placements** (the live two-cohort
 * seam — S-06). This is the pure half of `loadCombinedPlannerData`: it does no IO, so the loader
 * stays a thin row-mapper and this assembly is unit-tested directly. Availability and the union
 * teacher/student name maps are shared; groupings, placements, catalog, own-cohort names, stale, and
 * parked bundles stay per-cohort.
 */
export const assembleCombinedProps = (
  inputs: CombinedAssemblyInputs,
): { dp1: PlannerBoardProps; dp2: PlannerBoardProps } => ({
  dp1: buildColumn(inputs, inputs.dp1, inputs.dp2),
  dp2: buildColumn(inputs, inputs.dp2, inputs.dp1),
});

const buildColumn = (
  shared: CombinedAssemblyInputs,
  own: CombinedCohortInputs,
  other: CombinedCohortInputs,
): PlannerBoardProps => ({
  planId: shared.planId,
  cohort: own.cohort,
  days: shared.days,
  periods: shared.periods,
  groupings: own.groupings,
  stale: own.stale,
  names: own.names,
  teacherNames: shared.teacherNames,
  studentNames: shared.studentNames,
  placements: own.placements,
  catalog: own.catalog,
  availability: shared.availability,
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
