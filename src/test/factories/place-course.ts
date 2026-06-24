import { placeCourse as placeCourseDomain, type PlaceCourseInput } from "@/_pages/plan-detail/api/placements";
import type { SupabaseClient } from "@/shared/api";

/** Caller-facing input: `week` is optional and defaults to `both` (the agnostic case). */
export type PlaceCourseFactoryInput = Omit<PlaceCourseInput, "week"> & Partial<Pick<PlaceCourseInput, "week">>;

/**
 * Produce a placement (timetable **output**) by driving the real `placeCourse` domain
 * function — the production write path (the `place_course` RPC: find-or-create the cell's
 * bundle, then insert the placement carrying its `bundle_id`). So the output is computed by
 * the code under test, not hand-written. `week` defaults to `both` so call sites stay
 * week-agnostic.
 */
export function placeCourse(supabase: SupabaseClient, input: PlaceCourseFactoryInput) {
  return placeCourseDomain(supabase, { week: "both", ...input });
}
