import type { SupabaseClient } from "@/shared/api";
import type { DeleteOverlapInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";

/** Delete a directed course overlap by its (base, dependent) pair. */
export const deleteOverlap = async (supabase: SupabaseClient, input: DeleteOverlapInput) => {
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
