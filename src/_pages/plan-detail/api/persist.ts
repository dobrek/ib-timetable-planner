import type { Json, SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config";
import type { GroupingResult } from "../model/grouping";

type Supabase = SupabaseClient;

type GroupingPayload = {
  coverage_count: number;
  score: number;
  member_ids: string[];
};

/**
 * Dedups variants to distinct member-sets (the same maximal set under different
 * seeds collapses to one row) and replaces the cohort's groupings atomically via
 * the `replace_cohort_groupings` RPC. The RPC is one transaction — a client-side
 * delete + insert would risk wiping the rows if the insert failed (PostgREST has
 * no cross-call transaction). Member ids are course ids at runtime, so the payload
 * carries them directly.
 */
export const persistGroupings = async (
  supabase: Supabase,
  params: { planId: string; cohort: Cohort; catalogHash: string; results: GroupingResult[] },
): Promise<void> => {
  const groupings = toDistinctMemberSets(params.results);
  const { error } = await supabase.rpc("replace_cohort_groupings", {
    p_plan_id: params.planId,
    p_cohort: params.cohort,
    p_catalog_hash: params.catalogHash,
    p_groupings: groupings as unknown as Json,
  });
  if (error) throw new Error(`Failed to persist groupings for cohort ${params.cohort}: ${error.message}`);
};

const toDistinctMemberSets = (results: GroupingResult[]): GroupingPayload[] => {
  const bySet = new Map<string, GroupingPayload>();
  for (const { variants } of results) {
    for (const variant of variants) {
      const key = [...variant.memberIds].sort().join(",");
      if (!bySet.has(key)) {
        bySet.set(key, {
          coverage_count: variant.coverageCount,
          score: variant.score,
          member_ids: variant.memberIds,
        });
      }
    }
  }
  return [...bySet.values()];
};
