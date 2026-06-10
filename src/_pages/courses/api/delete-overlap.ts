import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DeleteOverlapInput } from "../model/schemas";

/** Delete a directed course overlap by its (base, dependent) pair. */
export const deleteOverlap = async (supabase: SupabaseClient, input: DeleteOverlapInput) =>
  unwrapCompleted(
    await supabase
      .from("course_overlaps")
      .delete()
      .eq("base_course_id", input.baseCourseId)
      .eq("dependent_course_id", input.dependentCourseId),
    "Failed to delete overlap",
  );
