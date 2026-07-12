import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { BulkChoiceInput } from "../model/schemas";
import { assertChoicesInCohort } from "./assert-choices-in-cohort";
import { assertStudentsInCohort } from "./assert-students-in-cohort";
import { BULK_EDIT_FAILED_MESSAGE } from "./constants";

/**
 * Apply an add-set and/or remove-set of course choices across many students in one atomic
 * RPC. Framework-free orchestration and the authoritative gate: verify every selected
 * student and every add-course belongs to the plan + cohort, then call the validation-free
 * bulk_edit_student_choices function (all-or-nothing). Remove ids need no cohort gate —
 * deleting a pair that can't exist is a no-op and the delete is plan-pinned. No CONFLICT
 * mapping: `on conflict do nothing` makes concurrent overlapping adds benign.
 */
export const bulkEditChoices = async (supabase: SupabaseClient, input: BulkChoiceInput): Promise<void> => {
  await assertStudentsInCohort(supabase, input.planId, input.cohort, input.studentIds);
  await assertChoicesInCohort(supabase, input.planId, input.cohort, input.addCourseIds);

  const { error } = await supabase.rpc("bulk_edit_student_choices", {
    p_plan_id: input.planId,
    p_student_ids: input.studentIds,
    p_add_course_ids: input.addCourseIds,
    p_remove_course_ids: input.removeCourseIds,
  });
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `${BULK_EDIT_FAILED_MESSAGE} ${error.message}`);
  }
};
