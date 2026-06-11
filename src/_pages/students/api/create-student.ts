import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { unwrapRow } from "@/shared/lib/postgrest";
import { writeParentWithLinks } from "@/shared/lib/write-parent-with-links";
import type { StudentInput } from "../model/schemas";
import { assertChoicesInCohort } from "./assert-choices-in-cohort";

/**
 * Insert a student and its full choice set with compensating cleanup. The cohort guard runs
 * first (authoritative — never trusting the client's scoped picker); then the student row is
 * inserted, the choices linked, and the student deleted if the link insert fails (no orphan).
 */
export const createStudent = async (supabase: SupabaseClient, input: StudentInput) => {
  await assertChoicesInCohort(supabase, input.planId, input.cohort, input.choiceCourseIds);

  return writeParentWithLinks({
    insertParent: async () =>
      unwrapRow(
        await supabase
          .from("students")
          .insert({ plan_id: input.planId, cohort: input.cohort, full_name: input.fullName })
          .select()
          .single(),
        { failure: "Failed to create student" },
      ),
    insertLinks: async (student) => {
      if (input.choiceCourseIds.length === 0) return;
      const { error } = await supabase
        .from("student_choices")
        .insert(
          input.choiceCourseIds.map((course_id) => ({ plan_id: input.planId, student_id: student.id, course_id })),
        );
      if (error) {
        throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to save choices: ${error.message}`);
      }
    },
    deleteParent: async (student) => {
      const { error } = await supabase.from("students").delete().eq("id", student.id);
      if (error) {
        // Double fault: the choice insert failed AND its compensating cleanup failed, leaving
        // a choiceless student. Surface it for tracing — the original error is still rethrown
        // to the caller by writeParentWithLinks.
        // eslint-disable-next-line no-console
        console.error(`[createStudent] orphan student ${student.id} left after failed cleanup: ${error.message}`);
      }
    },
  });
};
