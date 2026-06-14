import { unwrapCompleted, type SupabaseClient } from "@/shared/api";
import type { DeleteTeacherInput } from "../model/schemas";

/** Delete a teacher by id, pinned to its plan. courses.teacher_id cascades to SET NULL via FK. */
export const deleteTeacher = async (supabase: SupabaseClient, input: DeleteTeacherInput): Promise<void> => {
  unwrapCompleted(
    await supabase.from("teachers").delete().eq("plan_id", input.planId).eq("id", input.id),
    "Failed to delete teacher",
  );
};
