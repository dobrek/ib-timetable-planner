import { placeCourse as placeCourseDomain, type PlaceCourseInput } from "@/_pages/plan-detail/api/placements";
import type { SupabaseClient } from "@/shared/api";

/** Caller-facing input: `week` defaults to `both` (the agnostic case); `isOptional` defaults to `false`. */
export type PlaceCourseFactoryInput = Omit<PlaceCourseInput, "week" | "isOptional"> &
  Partial<Pick<PlaceCourseInput, "week" | "isOptional">>;

/**
 * Produce a placement (timetable **output**) by driving the real `placeCourse` domain
 * function — the production write path (the `place_course` RPC: find-or-create the cell's
 * bundle, then insert the placement carrying its `bundle_id`). So the output is computed by
 * the code under test, not hand-written. `week` defaults to `both` and `isOptional` to
 * `false` so call sites stay agnostic of both axes.
 */
export function placeCourse(supabase: SupabaseClient, input: PlaceCourseFactoryInput) {
  return placeCourseDomain(supabase, { week: "both", isOptional: false, ...input });
}
