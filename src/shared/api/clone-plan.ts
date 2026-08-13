import type { SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { loadCohortCourses } from "./load-cohort-courses";
import { unwrapCompleted, unwrapRow } from "./postgrest";

/**
 * Copy a scenario via the atomic `clone_plan` RPC. With `includeBoard` (the default) it
 * is a full deep copy, then each cohort's `catalog_hash` is recomputed over the clone's
 * catalog: the RPC copies grouping rows with the source hash, which fingerprints the
 * source's course UUIDs — without the JS-side recompute every cloned grouping would read
 * as stale. The hash stays a single TypeScript implementation by design; a plpgsql copy
 * could silently drift.
 *
 * With `includeBoard: false` the RPC skips the board entirely, so the clone has zero
 * `course_groupings` rows — the hash refresh would match nothing. We short-circuit it:
 * the clone lands on the compute-groupings cold start, exactly like a blank plan.
 *
 * **Lives in `shared/api` rather than in a page slice** because it has two consumers in
 * different `_pages` slices — `plans-list`'s Clone dialog and `plan-detail`'s generation
 * enqueue, which clones the plan as the proposal target — and a cross-`_pages` import is a
 * steiger error (`fsd/forbidden-imports`, measured). It belongs here rather than in
 * `entities/timetable`: it touches no entity type, only `shared/api` accessors and the
 * shared catalog hash, which is the same character as `loadCohortCourses` and
 * `loadPlanSummary` beside it. Callers own their own input validation — `plans-list` keeps
 * `clonePlanInput` as its action's Zod gate and passes the parsed fields through.
 */
export type ClonePlanParams = {
  sourcePlanId: string;
  name: string;
  includeBoard: boolean;
};

export const clonePlan = async (supabase: SupabaseClient, params: ClonePlanParams): Promise<{ id: string }> => {
  const newPlanId = unwrapRow(
    await supabase.rpc("clone_plan", {
      p_source_plan_id: params.sourcePlanId,
      p_name: params.name,
      p_include_board: params.includeBoard,
    }),
    { failure: "Failed to clone plan" },
  );

  // A catalog-only clone has no grouping rows to refresh — skip the two per-cohort queries.
  if (!params.includeBoard) return { id: newPlanId };

  // Best-effort: if the refresh fails the clone still exists — its groupings merely
  // read as stale, a state the board already handles (compute empty-state / re-run).
  try {
    for (const cohort of COHORT_VALUES) {
      await refreshCatalogHash(supabase, newPlanId, cohort);
    }
  } catch (refreshError) {
    // eslint-disable-next-line no-console
    console.error(`[clonePlan] catalog_hash refresh failed for plan ${newPlanId}:`, refreshError);
  }

  return { id: newPlanId };
};

const refreshCatalogHash = async (supabase: SupabaseClient, planId: string, cohort: Cohort): Promise<void> => {
  const { courses } = await loadCohortCourses(supabase, planId, cohort);
  const catalogHash = await computeCatalogHash(courses);
  unwrapCompleted(
    await supabase
      .from("course_groupings")
      .update({ catalog_hash: catalogHash })
      .eq("plan_id", planId)
      .eq("cohort", cohort),
    `hash update failed for cohort ${cohort}`,
  );
};
