import type { SupabaseClient } from "@/shared/api";
import type { TeacherInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";
import { DUPLICATE_TEACHER_MESSAGE, UNIQUE_VIOLATION } from "./constants";

/** Insert a teacher row. */
export const createTeacher = async (supabase: SupabaseClient, input: TeacherInput) => {
  const { data, error } = await supabase
    .from("teachers")
    .insert({
      code: input.code,
      full_name: input.fullName ?? null,
    })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new DomainError("CONFLICT", DUPLICATE_TEACHER_MESSAGE);
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create teacher: ${error.message}`);
  }
  return data;
};
