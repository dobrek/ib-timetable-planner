import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/shared/api";
import type { GroupingCourse, GroupingResult } from "@/entities/grouping";

type Supabase = SupabaseClient<Database>;

/** The catalog fingerprint that drives S-06 out-of-date detection. */
export type CatalogSnapshot = GroupingCourse[];

type GroupingPayload = {
  coverage_count: number;
  score: number;
  member_ids: string[];
};

/**
 * Stable SHA-256 (Web Crypto — edge-safe on workerd, global in Node) over a
 * canonical, sorted serialization of the catalog projection. The `GroupingCourse[]`
 * projection already folds overlaps and merges into each course's `studentKeys`, so
 * any change to course meta, choices, overlaps, or merges shifts the hash. Sorting
 * courses by id and student keys within each course makes the hash order-insensitive.
 */
export const computeCatalogHash = async (snapshot: CatalogSnapshot): Promise<string> => {
  const canonical = JSON.stringify(
    snapshot
      .map((course) => ({
        id: course.id,
        teacherKey: course.teacherKey,
        hours: course.hours,
        studentKeys: [...course.studentKeys].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  params: { planId: string; cohortId: string; catalogHash: string; results: GroupingResult[] },
): Promise<void> => {
  const groupings = toDistinctMemberSets(params.results);
  const { error } = await supabase.rpc("replace_cohort_groupings", {
    p_plan_id: params.planId,
    p_cohort_id: params.cohortId,
    p_catalog_hash: params.catalogHash,
    p_groupings: groupings as unknown as Json,
  });
  if (error) throw new Error(`Failed to persist groupings for cohort ${params.cohortId}: ${error.message}`);
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
