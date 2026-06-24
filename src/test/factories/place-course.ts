import { insertPlacement, type CreatePlacementInput } from "@/_pages/plan-detail/api/placements";
import type { SupabaseClient } from "@/shared/api";

/** Caller-facing input: `week` is optional and defaults to `both` (the agnostic case). */
export type PlaceCourseInput = Omit<CreatePlacementInput, "week"> & Partial<Pick<CreatePlacementInput, "week">>;

/**
 * Produce a placement (timetable **output**) by driving the real `insertPlacement`
 * domain function — so the output is computed by the code under test, not hand-written.
 * `week` defaults to `both` so existing call sites stay week-agnostic.
 *
 * Bundle-aware transitively: `insertPlacement` find-or-creates the cell's bundle and
 * writes the placement's now-`NOT NULL` `bundle_id` (Phase-1 bridge). Phase 3 repoints
 * both onto the atomic `place_course` action, exercising the production write path.
 */
export function placeCourse(supabase: SupabaseClient, input: PlaceCourseInput) {
  return insertPlacement(supabase, { week: "both", ...input });
}
