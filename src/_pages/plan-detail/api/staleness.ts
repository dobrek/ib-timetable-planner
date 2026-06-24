import { unwrapMaybeRow, type SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config";
import { computeCatalogHash, type GroupingCourse } from "@/shared/lib/catalog-hash";

type Supabase = SupabaseClient;

/**
 * The out-of-date primitive the palette surfaces in the UI. Hashes the live catalog
 * projection the caller already loaded and compares it to the `catalog_hash` stored on
 * the latest `course_groupings` row for `(plan_id, cohort)`. Stale when no rows exist,
 * the stored hash is absent, or it differs from the current catalog. Takes the catalog
 * rather than re-fetching it, so the board load runs no second `loadCohortCourses`.
 */
export const isGroupingStale = async (
  supabase: Supabase,
  params: { planId: string; cohort: Cohort; catalog: GroupingCourse[] },
): Promise<boolean> => {
  const currentHash = await computeCatalogHash(params.catalog);

  const stored = unwrapMaybeRow(
    await supabase
      .from("course_groupings")
      .select("catalog_hash")
      .eq("plan_id", params.planId)
      .eq("cohort", params.cohort)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "Failed to read stored grouping hash",
  );

  return stored?.catalog_hash == null || stored.catalog_hash !== currentHash;
};
