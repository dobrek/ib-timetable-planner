import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { OverlapInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";

/** Create a directed course overlap, enforcing both courses share the plan and cohort. */
export const createOverlap = async (supabase: SupabaseClient, input: OverlapInput) => {
  // Both courses must belong to the plan and share a cohort — overlaps are within a school year.
  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("id, cohort")
    .eq("plan_id", input.planId)
    .in("id", [input.baseCourseId, input.dependentCourseId]);
  if (lookupError) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Course lookup failed: ${lookupError.message}`);
  }
  if (courses.length !== 2) {
    throw new DomainError("NOT_FOUND", "One or both courses no longer exist.");
  }
  if (courses[0].cohort !== courses[1].cohort) {
    throw new DomainError("BAD_REQUEST", "Overlapping courses must be in the same cohort.");
  }

  return unwrapRow(
    await supabase
      .from("course_overlaps")
      .insert({
        plan_id: input.planId,
        base_course_id: input.baseCourseId,
        dependent_course_id: input.dependentCourseId,
      })
      .select()
      .single(),
    { conflict: "This overlap already exists.", failure: "Failed to create overlap" },
  );
};
