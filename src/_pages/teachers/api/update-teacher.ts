import type { SupabaseClient } from "@/shared/api";
import type { UpdateTeacherInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";
import { DUPLICATE_TEACHER_MESSAGE, UNIQUE_VIOLATION } from "./constants";

/** Update a teacher's code and/or full_name by id. */
export const updateTeacher = async (supabase: SupabaseClient, input: UpdateTeacherInput) => {
  const { data, error } = await supabase
    .from("teachers")
    .update({
      code: input.code,
      full_name: input.fullName ?? null,
    })
    .eq("id", input.id)
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new DomainError("CONFLICT", DUPLICATE_TEACHER_MESSAGE);
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to update teacher: ${error.message}`);
  }
  return data;
};
