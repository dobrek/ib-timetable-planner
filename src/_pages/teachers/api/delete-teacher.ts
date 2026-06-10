import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DeleteTeacherInput } from "../model/schemas";

/** Delete a teacher by id. courses.teacher_id cascades to SET NULL via FK. */
export const deleteTeacher = async (supabase: SupabaseClient, input: DeleteTeacherInput) =>
  unwrapCompleted(await supabase.from("teachers").delete().eq("id", input.id), "Failed to delete teacher");
