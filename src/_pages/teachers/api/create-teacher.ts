import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { TeacherInput } from "../model/schemas";
import { DUPLICATE_TEACHER_MESSAGE } from "./constants";

/** Insert a teacher row into the plan. */
export const createTeacher = async (supabase: SupabaseClient, input: TeacherInput) =>
  unwrapRow(
    await supabase
      .from("teachers")
      .insert({ plan_id: input.planId, code: input.code, full_name: input.fullName ?? null })
      .select()
      .single(),
    { conflict: DUPLICATE_TEACHER_MESSAGE, failure: "Failed to create teacher" },
  );
