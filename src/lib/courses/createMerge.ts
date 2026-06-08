import type { MergeInput } from "../schemas/course";
import { DomainError } from "../errors";
import { deriveMergeParent, mergeReasonMessage, writeMergeAtomic } from "./merge";
import { DUPLICATE_COURSE_MESSAGE, UNIQUE_VIOLATION, type Supabase } from "./shared";

/**
 * Authoritative create-merge gate. Loads the selected children, re-runs `deriveMergeParent`
 * server-side (never trusting the client), inserts the composite parent then its links, and
 * compensates by deleting the parent if the link insert fails (no orphan parent).
 */
export const createMerge = async (supabase: Supabase, input: MergeInput) => {
  const { data: childRows, error: lookupError } = await supabase
    .from("courses")
    .select("id, cohort_id, name, level, teacher_id")
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
      cohortId: c.cohort_id,
      teacherId: c.teacher_id,
    })),
  );
  if (!derivation.ok) {
    throw new DomainError("BAD_REQUEST", mergeReasonMessage(derivation.reason));
  }
  // Reject a spoofed/stale client cohort so the parent can't land in the wrong cohort.
  if (input.cohortId !== derivation.parent.cohortId) {
    throw new DomainError("BAD_REQUEST", "Selected courses are not in the requested cohort.");
  }

  return writeMergeAtomic({
    insertParent: async () => {
      const { data, error } = await supabase
        .from("courses")
        .insert({
          cohort_id: derivation.parent.cohortId,
          teacher_id: derivation.parent.teacherId,
          name: derivation.parent.name,
          level: derivation.parent.level,
          group_index: 0,
          hours_per_week: input.hoursPerWeek,
        })
        .select()
        .single();
      if (error?.code === UNIQUE_VIOLATION) {
        throw new DomainError("CONFLICT", DUPLICATE_COURSE_MESSAGE);
      }
      if (error) {
        throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create merge: ${error.message}`);
      }
      return data;
    },
    insertLinks: async (parent) => {
      const { error } = await supabase
        .from("course_merges")
        .insert(input.childCourseIds.map((child_course_id) => ({ parent_course_id: parent.id, child_course_id })));
      if (error) {
        throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create merge: ${error.message}`);
      }
    },
    deleteParent: async (parent) => {
      await supabase.from("courses").delete().eq("id", parent.id);
    },
  });
};
