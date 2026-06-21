import { unwrapMany, unwrapRow, unwrapCompleted, type SupabaseClient } from "@/shared/api";
import { groupByInto } from "@/shared/lib/collections";
import type { MergeInput } from "../model/schemas";
import { deriveMergeParent, mergeReasonMessage } from "../model/merge";
import { DomainError } from "@/shared/lib/errors";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { writeParentWithLinks } from "@/shared/lib/write-parent-with-links";

/**
 * Authoritative create-merge gate. Loads the selected children (pinned to the plan) and
 * their teacher *sets* from the course_teachers junction, re-runs `deriveMergeParent`
 * server-side (never trusting the client), inserts the composite parent, then its merge
 * links AND its own course_teachers rows (so the composite session is a real co-taught
 * course on the board), compensating by deleting the parent — which cascades both link
 * tables — if any link insert fails (no orphan parent, no teacher-less composite).
 */
export const createMerge = async (supabase: SupabaseClient, input: MergeInput) => {
  const childRows = unwrapMany(
    await supabase
      .from("courses")
      .select("id, cohort, name, level")
      .eq("plan_id", input.planId)
      .in("id", input.childCourseIds),
    "Course lookup failed",
  );
  if (childRows.length !== input.childCourseIds.length) {
    throw new DomainError("NOT_FOUND", "One or more courses no longer exist.");
  }

  // Each child's teacher SET from the junction — the source of truth for the merge rule.
  const childTeacherLinks = unwrapMany(
    await supabase
      .from("course_teachers")
      .select("course_id, teacher_id")
      .eq("plan_id", input.planId)
      .in("course_id", input.childCourseIds),
    "Course teacher lookup failed",
  );
  const teachersByCourse = groupByInto(
    childTeacherLinks,
    (link) => link.course_id,
    (link) => link.teacher_id,
  );

  const derivation = deriveMergeParent(
    childRows.map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      cohort: c.cohort,
      teacherIds: teachersByCourse.get(c.id) ?? [],
    })),
  );
  if (!derivation.ok) {
    throw new DomainError("BAD_REQUEST", mergeReasonMessage(derivation.reason));
  }
  // Reject a spoofed/stale client cohort so the parent can't land in the wrong cohort.
  if (input.cohort !== derivation.parent.cohort) {
    throw new DomainError("BAD_REQUEST", "Selected courses are not in the requested cohort.");
  }

  const parentTeacherIds = derivation.parent.teacherIds;
  return writeParentWithLinks({
    insertParent: async () =>
      unwrapRow(
        await supabase
          .from("courses")
          .insert({
            plan_id: input.planId,
            cohort: derivation.parent.cohort,
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
      unwrapCompleted(
        await supabase.from("course_merges").insert(
          input.childCourseIds.map((child_course_id) => ({
            plan_id: input.planId,
            parent_course_id: parent.id,
            child_course_id,
          })),
        ),
        "Failed to create merge",
      );
      // The composite parent is a real course on the board — persist its teacher set in
      // the junction too, or it would render teacher-less and lose conflict/availability.
      unwrapCompleted(
        await supabase.from("course_teachers").insert(
          parentTeacherIds.map((teacher_id) => ({
            plan_id: input.planId,
            course_id: parent.id,
            teacher_id,
          })),
        ),
        "Failed to assign merge teachers",
      );
    },
    deleteParent: async (parent) => {
      // Deleting the parent cascades both course_merges and course_teachers (ON DELETE CASCADE).
      const { error } = await supabase.from("courses").delete().eq("id", parent.id);
      if (error) {
        // Double fault: a link insert failed AND its compensating cleanup failed, leaving an
        // orphan parent. Surface it for tracing — the original link error is still rethrown
        // to the caller by writeParentWithLinks.
        // eslint-disable-next-line no-console
        console.error(`[createMerge] orphan parent ${parent.id} left after failed cleanup: ${error.message}`);
      }
    },
  });
};
