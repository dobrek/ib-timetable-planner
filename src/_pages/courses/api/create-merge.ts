import { unwrapRow, type SupabaseClient } from "@/shared/api";
import type { MergeInput } from "../model/schemas";
import { deriveMergeParent, mergeReasonMessage } from "../model/merge";
import { DomainError } from "@/shared/lib/errors";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { writeParentWithLinks } from "@/shared/lib/write-parent-with-links";

/**
 * Authoritative create-merge gate. Loads the selected children (pinned to the plan),
 * re-runs `deriveMergeParent` server-side (never trusting the client), inserts the
 * composite parent then its links, and compensates by deleting the parent if the link
 * insert fails (no orphan parent).
 */
export const createMerge = async (supabase: SupabaseClient, input: MergeInput) => {
  const { data: childRows, error: lookupError } = await supabase
    .from("courses")
    .select("id, cohort, name, level, teacher_id")
    .eq("plan_id", input.planId)
    .in("id", input.childCourseIds);
  if (lookupError) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Course lookup failed: ${lookupError.message}`);
  }
  if (childRows.length !== input.childCourseIds.length) {
    throw new DomainError("NOT_FOUND", "One or more courses no longer exist.");
  }

  const derivation = deriveMergeParent(
    childRows.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      cohort: c.cohort,
      teacherId: c.teacher_id,
    })),
  );
  if (!derivation.ok) {
    throw new DomainError("BAD_REQUEST", mergeReasonMessage(derivation.reason));
  }
  // Reject a spoofed/stale client cohort so the parent can't land in the wrong cohort.
  if (input.cohort !== derivation.parent.cohort) {
    throw new DomainError("BAD_REQUEST", "Selected courses are not in the requested cohort.");
  }

  return writeParentWithLinks({
    insertParent: async () =>
      unwrapRow(
        await supabase
          .from("courses")
          .insert({
            plan_id: input.planId,
            cohort: derivation.parent.cohort,
            teacher_id: derivation.parent.teacherId,
            name: derivation.parent.name,
            level: derivation.parent.level,
            group_index: 0,
            hours_per_week: input.hoursPerWeek,
          })
          .select()
          .single(),
        { conflict: DUPLICATE_COURSE_MESSAGE, failure: "Failed to create merge" },
      ),
    insertLinks: async (parent) => {
      const { error } = await supabase.from("course_merges").insert(
        input.childCourseIds.map((child_course_id) => ({
          plan_id: input.planId,
          parent_course_id: parent.id,
          child_course_id,
        })),
      );
      if (error) {
        throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create merge: ${error.message}`);
      }
    },
    deleteParent: async (parent) => {
      const { error } = await supabase.from("courses").delete().eq("id", parent.id);
      if (error) {
        // Double fault: the link insert failed AND its compensating cleanup failed,
        // leaving an orphan parent. Surface it for tracing — the original link error
        // is still rethrown to the caller by writeParentWithLinks.
        // eslint-disable-next-line no-console
        console.error(`[createMerge] orphan parent ${parent.id} left after failed cleanup: ${error.message}`);
      }
    },
  });
};
