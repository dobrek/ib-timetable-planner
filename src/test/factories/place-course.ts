import { insertPlacement, type CreatePlacementInput } from "@/_pages/plan-detail/api/placements";
import type { SupabaseClient } from "@/shared/api";

/** Caller-facing input: `week` is optional and defaults to `both` (the agnostic case). */
export type PlaceCourseInput = Omit<CreatePlacementInput, "week"> & Partial<Pick<CreatePlacementInput, "week">>;

/**
 * Produce a placement (timetable **output**) by driving the real `insertPlacement`
 * domain function — so the output is computed by the code under test, not hand-written.
 * `week` defaults to `both` so existing call sites stay week-agnostic.
 */
export function placeCourse(supabase: SupabaseClient, input: PlaceCourseInput) {
  return insertPlacement(supabase, { week: "both", ...input });
}
