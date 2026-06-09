import type { SupabaseClient } from "@/shared/api";
import type { DeleteCourseInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";

/** Delete a course by id (its merge/overlap links cascade via FK). */
export const deleteCourse = async (supabase: SupabaseClient, input: DeleteCourseInput) => {
  const { error } = await supabase.from("courses").delete().eq("id", input.id);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete course: ${error.message}`);
  }
  return { ok: true as const };
};
