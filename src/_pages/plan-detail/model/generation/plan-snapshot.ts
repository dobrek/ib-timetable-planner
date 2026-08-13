import type { Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import {
  assembleGeneratorSnapshot,
  autoParkPhantomCourses,
  type AutoParkedEntry,
  type GeneratorSnapshot,
  type PlannerPlacement,
  type SharedSnapshotInput,
} from "@/entities/timetable";
import type { ParkedBundle } from "../placement/parked";

/**
 * The server side of the Generate click: a plan's loaded board state → the exact snapshot dispatched
 * to the solver.
 *
 * It reads the SAME shapes `loadCombinedPlannerData` already hands the island, which is the point.
 * The client assembles its snapshot from `PlannerBoardProps` (`use-cohort-board-state.ts`); this
 * assembles from the loader output those props are built from. So the snapshot the server hashes into
 * `generation_jobs.snapshot_hash` is, by construction, the one the author's own board would produce —
 * rather than a second server-side loader that agrees with the board only by convention.
 *
 * Auto-parking runs HERE, between assembly and hashing, so the hash covers the snapshot actually
 * solved. A course whose expanded roster is empty cannot be scheduled or judged complete; parking its
 * uncovered hours is what bench and the human expert already do before every solve, and `autoParked`
 * is the audit list the caller records.
 *
 * Pure — no Supabase, no `astro:env`. Takes the pieces rather than `CombinedPlannerData` so `model/`
 * does not reach into `api/`.
 */
export type CohortBoardSlice = {
  catalog: GroupingCourse[];
  placements: PlannerPlacement[];
  parkedBundles: ParkedBundle[];
};

export type PlanSnapshot = { snapshot: GeneratorSnapshot; autoParked: AutoParkedEntry[] };

export const toPlanSnapshot = (shared: SharedSnapshotInput, cohorts: Record<Cohort, CohortBoardSlice>): PlanSnapshot =>
  autoParkPhantomCourses(
    assembleGeneratorSnapshot(shared, {
      dp1: toCohortInput(cohorts.dp1),
      dp2: toCohortInput(cohorts.dp2),
    }),
  );

/** Parked bundles flatten to the course-id multiset the deficit derivation consumes — one entry per
 *  off-board hour, never deduped. Mirrors the island's own `toSnapshotInput`. */
const toCohortInput = ({ catalog, placements, parkedBundles }: CohortBoardSlice) => ({
  courses: catalog,
  placements,
  parkedCourseIds: parkedBundles.flatMap((bundle) => bundle.members.map((member) => member.courseId)),
});
