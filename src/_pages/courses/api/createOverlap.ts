import type { OverlapInput } from "@/entities/course";
import { DomainError } from "@/shared/lib/errors";
import { UNIQUE_VIOLATION, type Supabase } from "./shared";

/** Create a directed course overlap, enforcing both courses share a cohort. */
export const createOverlap = async (supabase: Supabase, input: OverlapInput) => {
  // Both courses must belong to the same cohort — overlaps are within a school year.
  const { data: courses, error: lookupError } = await supabase
    .from("courses")
    .select("id, cohort_id")
    .in("id", [input.baseCourseId, input.dependentCourseId]);
  if (lookupError) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Course lookup failed: ${lookupError.message}`);
  }
  if (courses.length !== 2) {
    throw new DomainError("NOT_FOUND", "One or both courses no longer exist.");
  }
  if (courses[0].cohort_id !== courses[1].cohort_id) {
    throw new DomainError("BAD_REQUEST", "Overlapping courses must be in the same cohort.");
  }

  const { data, error } = await supabase
    .from("course_overlaps")
    .insert({ base_course_id: input.baseCourseId, dependent_course_id: input.dependentCourseId })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new DomainError("CONFLICT", "This overlap already exists.");
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create overlap: ${error.message}`);
  }
  return data;
};
