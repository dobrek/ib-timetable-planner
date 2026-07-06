import type { SupabaseClient } from "@/shared/api";

/**
 * One plan's teacher-availability cells (plan-scoped, cohort-independent) — the raw
 * PostgREST response, so composing loaders keep batching through `assertNoQueryErrors`.
 */
export const loadTeacherAvailability = (supabase: SupabaseClient, planId: string) =>
  supabase.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", planId).limit(5000);
