import type { SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config";
import { computeCatalogHash, loadCohortCourses } from "@/shared/lib/catalog-hash";

type Supabase = SupabaseClient;

/**
 * The out-of-date primitive S-06 surfaces in the UI (no UI here). Computes the
 * current catalog hash and compares it to the `catalog_hash` stored on the latest
 * `course_groupings` row for `(plan_id, cohort)`. Stale when no rows exist, the
 * stored hash is absent, or it differs from the current catalog.
 */
export const isGroupingStale = async (
  supabase: Supabase,
  params: { planId: string; cohort: Cohort },
): Promise<boolean> => {
  const { courses } = await loadCohortCourses(supabase, params.planId, params.cohort);
  const currentHash = await computeCatalogHash(courses);

  const { data, error } = await supabase
    .from("course_groupings")
    .select("catalog_hash")
    .eq("plan_id", params.planId)
    .eq("cohort", params.cohort)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to read stored grouping hash: ${error.message}`);

  return data?.catalog_hash == null || data.catalog_hash !== currentHash;
};
