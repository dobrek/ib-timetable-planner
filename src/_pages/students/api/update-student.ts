import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { UpdateStudentInput } from "../model/schemas";

/** Update a student's full_name and cohort_id by id. (Choices handling joins in Phase 2.) */
export const updateStudent = async (supabase: SupabaseClient, input: UpdateStudentInput) =>
  unwrapRow(
    await supabase
      .from("students")
      .update({ cohort_id: input.cohortId, full_name: input.fullName })
      .eq("id", input.id)
      .select()
      .single(),
    { notFound: "Student not found.", failure: "Failed to update student" },
  );
