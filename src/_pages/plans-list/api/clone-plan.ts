import { loadCohortCourses, type SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { DomainError } from "@/shared/lib/errors";
import type { ClonePlanInput } from "../model/schemas";

/**
 * Deep-copy a whole scenario via the atomic `clone_plan` RPC, then recompute each
 * cohort's `catalog_hash` over the clone's catalog. The RPC copies grouping rows
 * with the source hash, which fingerprints the source's course UUIDs — without the
 * JS-side recompute every cloned grouping would read as stale. The hash stays a
 * single TypeScript implementation by design (see plan.md Critical Implementation
 * Details); a plpgsql copy could silently drift.
 */
export const clonePlan = async (supabase: SupabaseClient, input: ClonePlanInput): Promise<{ id: string }> => {
  const { data: newPlanId, error } = await supabase.rpc("clone_plan", {
    p_source_plan_id: input.sourcePlanId,
    p_name: input.name,
  });
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to clone plan: ${error.message}`);
  }

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
  const { error } = await supabase
    .from("course_groupings")
    .update({ catalog_hash: catalogHash })
    .eq("plan_id", planId)
    .eq("cohort", cohort);
  if (error) throw new Error(`hash update failed for cohort ${cohort}: ${error.message}`);
};
