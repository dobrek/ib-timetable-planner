import type { Cohort } from "@/shared/config";
import type {
  GeneratorCohortSnapshot,
  GeneratorSnapshot,
  LocalPlacement,
  PlannerPlacement,
} from "@/entities/timetable";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { SharedBoardProps } from "../drag";
import type { LocalParkedBundle } from "../placement/parked";

/**
 * Build a `GeneratorSnapshot` from the live combined board state — the same data
 * `useCombinedBoardState` already owns per cohort, passed explicitly so the assembly stays
 * a pure, hook-free function. Current placements go in as-is: they are the pins
 * (fill-the-gaps — the generator never moves them). Local-state markers (`pending`,
 * `bundleId`) are stripped so the snapshot is plain structured-clone-safe data for the
 * worker boundary.
 */
export type CohortSnapshotInput = {
  catalog: GroupingCourse[];
  placements: LocalPlacement[];
  parkedBundles: LocalParkedBundle[];
};

export const assembleGeneratorSnapshot = (
  shared: Pick<SharedBoardProps, "days" | "periods" | "availability" | "finishesEarlyByCourseId">,
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

const toCohortSnapshot = ({ catalog, placements, parkedBundles }: CohortSnapshotInput): GeneratorCohortSnapshot => ({
  courses: catalog,
  pins: placements.map(toPin),
  parkedCourseIds: parkedBundles.flatMap((bundle) => bundle.members.map((member) => member.courseId)),
});

const toPin = ({ id, courseId, day, period, week, isOptional }: LocalPlacement): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional,
});
