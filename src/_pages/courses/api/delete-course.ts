import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DeleteCourseInput } from "../model/schemas";

/** Delete a course by id, pinned to its plan (merge/overlap links cascade via FK). */
export const deleteCourse = async (supabase: SupabaseClient, input: DeleteCourseInput) =>
  unwrapCompleted(
    await supabase.from("courses").delete().eq("plan_id", input.planId).eq("id", input.id),
    "Failed to delete course",
  );
