import { unwrapRow, unwrapCompleted, type Json, type SupabaseClient } from "@/shared/api";
import type { UpdateCourseInput } from "../model/schemas";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { toCourseRecord } from "./course-record";

/**
 * Update an existing course's meta by id (pinned to its plan), then atomically replace
 * its teacher set via the `replace_course_teachers` RPC. The RPC does delete+reinsert in
 * one transaction — a client-side delete + failed insert would leave the course with zero
 * teachers (the partial-write hazard `writeParentWithLinks` only covers on create).
 */
export const updateCourse = async (supabase: SupabaseClient, input: UpdateCourseInput) => {
  const course = unwrapRow(
    await supabase
      .from("courses")
      .update(toCourseRecord(input))
      .eq("plan_id", input.planId)
      .eq("id", input.id)
      .select()
      .single(),
    {
      conflict: DUPLICATE_COURSE_MESSAGE,
      notFound: "Course not found.",
      failure: "Failed to update course",
    },
  );

  unwrapCompleted(
    await supabase.rpc("replace_course_teachers", {
      p_plan_id: input.planId,
      p_course_id: input.id,
      p_teacher_ids: input.teacherIds as unknown as Json,
    }),
    "Failed to update teachers",
  );

  return course;
};
