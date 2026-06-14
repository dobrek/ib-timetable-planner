import { unwrapCompleted, type SupabaseClient } from "@/shared/api";
import type { DeleteOverlapInput } from "../model/schemas";

/** Delete a directed course overlap by its (base, dependent) pair, pinned to its plan. */
export const deleteOverlap = async (supabase: SupabaseClient, input: DeleteOverlapInput) =>
  unwrapCompleted(
    await supabase
      .from("course_overlaps")
      .delete()
      .eq("plan_id", input.planId)
      .eq("base_course_id", input.baseCourseId)
      .eq("dependent_course_id", input.dependentCourseId),
    "Failed to delete overlap",
  );
