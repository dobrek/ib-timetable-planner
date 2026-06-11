import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DeleteStudentInput } from "../model/schemas";

/** Delete a student by id, pinned to its plan. student_choices cascade via FK ON DELETE CASCADE. */
export const deleteStudent = async (supabase: SupabaseClient, input: DeleteStudentInput) =>
  unwrapCompleted(
    await supabase.from("students").delete().eq("plan_id", input.planId).eq("id", input.id),
    "Failed to delete student",
  );
