import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { UNIQUE_VIOLATION, unwrapRow } from "@/shared/lib/postgrest";
import { diffChoices } from "../model/diff-choices";
import type { UpdateStudentInput } from "../model/schemas";
import { assertChoicesInCohort } from "./assert-choices-in-cohort";
import { CHOICES_CONFLICT_MESSAGE } from "./constants";

/**
 * Update a student's row (pinned to its plan), then reconcile its choices as an
 * insert-then-delete diff. For same-cohort edits the ordering is load-bearing: a failure
 * between insert and delete can only leave a visible superset the author can re-edit, never
 * silently-lost choices. A cohort change is weaker: the row's new cohort commits first, so a
 * failure during reconciliation can leave old-cohort choices attached until the author
 * re-saves — visible in the table, but consumers (S-06 grouping) must not assume choice
 * cohorts match the student row. Closing this window needs a transaction, which the project
 * rules out (no client transactions, no new Postgres functions).
 */
export const updateStudent = async (supabase: SupabaseClient, input: UpdateStudentInput) => {
  await assertChoicesInCohort(supabase, input.planId, input.cohort, input.choiceCourseIds);

  const student = unwrapRow(
    await supabase
      .from("students")
      .update({ cohort: input.cohort, full_name: input.fullName })
      .eq("plan_id", input.planId)
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
      .insert(toAdd.map((course_id) => ({ plan_id: input.planId, student_id: input.id, course_id })));
    if (error) {
      // A concurrent editor can insert an overlapping choice between our read and this write.
      if (error.code === UNIQUE_VIOLATION) {
        throw new DomainError("CONFLICT", CHOICES_CONFLICT_MESSAGE);
      }
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
