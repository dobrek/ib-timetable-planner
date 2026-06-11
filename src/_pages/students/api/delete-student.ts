import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DeleteStudentInput } from "../model/schemas";

/** Delete a student by id. student_choices cascade via FK ON DELETE CASCADE. */
export const deleteStudent = async (supabase: SupabaseClient, input: DeleteStudentInput) =>
  unwrapCompleted(await supabase.from("students").delete().eq("id", input.id), "Failed to delete student");
