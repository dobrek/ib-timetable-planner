import { insertPlacement, type CreatePlacementInput } from "@/_pages/plan-detail/api/placements";
import type { SupabaseClient } from "@/shared/api";

/**
 * Produce a placement (timetable **output**) by driving the real `insertPlacement`
 * domain function — so the output is computed by the code under test, not hand-written.
 */
export function placeCourse(supabase: SupabaseClient, input: CreatePlacementInput) {
  return insertPlacement(supabase, input);
}
