import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { unwrapRow } from "@/shared/lib/postgrest";
import { diffChoices } from "../model/diff-choices";
import type { UpdateStudentInput } from "../model/schemas";
import { assertChoicesInCohort } from "./assert-choices-in-cohort";

/**
 * Update a student's row, then reconcile its choices as an insert-then-delete diff. Ordering
 * is load-bearing: a failure between insert and delete can only leave a visible superset the
 * author can re-edit, never silently-lost choices. A cohort change lands all old-cohort choices
 * in `toRemove` naturally because the guard has already pinned `next` to the new cohort.
 */
export const updateStudent = async (supabase: SupabaseClient, input: UpdateStudentInput) => {
  await assertChoicesInCohort(supabase, input.cohortId, input.choiceCourseIds);

  const student = unwrapRow(
    await supabase
      .from("students")
      .update({ cohort_id: input.cohortId, full_name: input.fullName })
      .eq("id", input.id)
      .select()
      .single(),
    { notFound: "Student not found.", failure: "Failed to update student" },
  );

  const current = await readChoiceCourseIds(supabase, input.id);
  const { toAdd, toRemove } = diffChoices(current, input.choiceCourseIds);

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("student_choices")
      .insert(toAdd.map((course_id) => ({ student_id: input.id, course_id })));
    if (error) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to add choices: ${error.message}`);
    }
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("student_choices")
      .delete()
      .eq("student_id", input.id)
      .in("course_id", toRemove);
    if (error) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to remove choices: ${error.message}`);
    }
  }

  return student;
};

const readChoiceCourseIds = async (supabase: SupabaseClient, studentId: string): Promise<string[]> => {
  const { data, error } = await supabase.from("student_choices").select("course_id").eq("student_id", studentId);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Choice lookup failed: ${error.message}`);
  }
  return data.map((choice) => choice.course_id);
};
