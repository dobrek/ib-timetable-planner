import { computeSnapshotHash } from "@/entities/timetable";
import type { Database } from "@/shared/api";

/**
 * A minimal but honest `generation_jobs` row for `planId`, not yet inserted: an empty two-cohort
 * snapshot, with `snapshot_hash` its real canonical digest. For a caller that inserts the row
 * through a client of its own (the role matrix's INSERT cells); `addGenerationJob` inserts it with
 * the service role.
 */
export async function generationJobRow(
  planId: string,
): Promise<Database["public"]["Tables"]["generation_jobs"]["Insert"]> {
  const snapshot = {
    days: 5,
    periods: 10,
    availability: [],
    finishesEarlyByCourseId: [],
    cohorts: {
      dp1: { courses: [], pins: [], parkedCourseIds: [] },
      dp2: { courses: [], pins: [], parkedCourseIds: [] },
    },
  };
  return {
    plan_id: planId,
    policy: { budgetMs: 20_000, mode: "full" },
    snapshot,
    snapshot_hash: await computeSnapshotHash(snapshot),
  };
}
