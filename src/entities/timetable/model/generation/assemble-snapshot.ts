import type { Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { BoardAvailabilityCell } from "../availability-index";
import type { PlannerPlacement } from "../placement";
import type { GeneratorCohortSnapshot, GeneratorSnapshot } from "./types";

/**
 * The single assembly of a `GeneratorSnapshot` from board state — engine-agnostic, so the in-app
 * board and any headless runner (the experiment harness, a future CLI) build the *same* snapshot by
 * construction rather than by convention. Current placements go in as-is: they are the pins
 * (fill-the-gaps — the generator never moves them), projected down to `PlannerPlacement` so
 * caller-local markers (`pending`, `bundleId`) never cross the worker boundary.
 *
 * Inputs are stated in entity terms (grid, availability, per-cohort courses / placements / parked
 * course ids). Callers adapt their own shapes at the call site: `plan-detail` flattens its parked
 * bundles into the course-id multiset, the harness reads both straight from DB rows.
 */
export type SharedSnapshotInput = {
  days: number;
  periods: number;
  availability: BoardAvailabilityCell[];
  /** Ids of every course flagged `finishes_early` across BOTH cohorts (plan-scoped side-set). */
  finishesEarlyByCourseId: string[];
};

export type CohortSnapshotInput = {
  courses: GroupingCourse[];
  placements: PlannerPlacement[];
  /** One entry per parked (shelved) bundle member — a multiset; each entry covers one hour. */
  parkedCourseIds: string[];
};

export const assembleGeneratorSnapshot = (
  shared: SharedSnapshotInput,
  cohorts: Record<Cohort, CohortSnapshotInput>,
): GeneratorSnapshot => ({
  days: shared.days,
  periods: shared.periods,
  availability: shared.availability,
  finishesEarlyByCourseId: shared.finishesEarlyByCourseId,
  cohorts: {
    dp1: toCohortSnapshot(cohorts.dp1),
    dp2: toCohortSnapshot(cohorts.dp2),
  },
});

const toCohortSnapshot = ({ courses, placements, parkedCourseIds }: CohortSnapshotInput): GeneratorCohortSnapshot => ({
  courses,
  pins: placements.map(toPin),
  parkedCourseIds,
});

const toPin = ({ id, courseId, day, period, week, isOptional }: PlannerPlacement): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional,
});
