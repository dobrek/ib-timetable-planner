import { computeAndPersistGroupings, type ComputeGroupingsInput } from "@/_pages/plan-detail/api/grouping-compute";
import type { SupabaseClient } from "@/shared/api";

/**
 * Produce computed palette groupings (**output**) by driving the real
 * `computeAndPersistGroupings` domain function — loads the plan-cohort catalog,
 * enumerates groupings, hashes the catalog, and persists via the RPC.
 */
export function computeGroupingsFor(supabase: SupabaseClient, input: ComputeGroupingsInput) {
  return computeAndPersistGroupings(supabase, input);
}
