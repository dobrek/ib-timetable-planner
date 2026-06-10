import type { SupabaseClient } from "@/shared/api";
import type { DeleteTeacherInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";

/** Delete a teacher by id. courses.teacher_id cascades to SET NULL via FK. */
export const deleteTeacher = async (supabase: SupabaseClient, input: DeleteTeacherInput) => {
  const { error } = await supabase.from("teachers").delete().eq("id", input.id);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete teacher: ${error.message}`);
  }
  return { ok: true as const };
};
