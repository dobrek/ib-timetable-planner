import { unwrapRow, type SupabaseClient } from "@/shared/api";
import type { UpdateTeacherInput } from "../model/schemas";
import { DUPLICATE_TEACHER_MESSAGE } from "./constants";

/** Update a teacher's code and/or full_name by id, pinned to its plan. */
export const updateTeacher = async (supabase: SupabaseClient, input: UpdateTeacherInput) =>
  unwrapRow(
    await supabase
      .from("teachers")
      .update({ code: input.code, full_name: input.fullName ?? null })
      .eq("plan_id", input.planId)
      .eq("id", input.id)
      .select()
      .single(),
    { conflict: DUPLICATE_TEACHER_MESSAGE, notFound: "Teacher not found.", failure: "Failed to update teacher" },
  );
