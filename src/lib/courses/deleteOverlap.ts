import type { DeleteOverlapInput } from "../schemas/course";
import { DomainError } from "../errors";
import type { Supabase } from "./shared";

/** Delete a directed course overlap by its (base, dependent) pair. */
export const deleteOverlap = async (supabase: Supabase, input: DeleteOverlapInput) => {
  const { error } = await supabase
    .from("course_overlaps")
    .delete()
    .eq("base_course_id", input.baseCourseId)
    .eq("dependent_course_id", input.dependentCourseId);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete overlap: ${error.message}`);
  }
  return { ok: true as const };
};
