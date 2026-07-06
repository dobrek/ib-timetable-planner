import type { SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config/cohorts";

/**
 * One plan-cohort's placements — the raw PostgREST response, so composing loaders keep
 * batching results through `assertNoQueryErrors` exactly as before the promotion.
 */
export const loadPlacements = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("placements")
    .select("id, course_id, day, period, week, bundle_id")
    .eq("plan_id", planId)
    .eq("cohort", cohort)
    .limit(2000);
