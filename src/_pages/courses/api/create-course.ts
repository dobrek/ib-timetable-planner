import { unwrapRow, unwrapCompleted, type SupabaseClient } from "@/shared/api";
import { writeParentWithLinks } from "@/shared/lib/write-parent-with-links";
import type { CourseInput } from "../model/schemas";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { toCourseRecord } from "./course-record";

/**
 * Insert a course then its `course_teachers` junction rows, atomically: the parent
 * course is created first, the teacher links second, and a compensating delete removes
 * the parent if the link insert fails (no orphan, teacher-less course). Mirrors
 * `createMerge` — workerd/PostgREST has no client transaction for the create path.
 */
export const createCourse = async (supabase: SupabaseClient, input: CourseInput) =>
  writeParentWithLinks({
    insertParent: async () =>
      unwrapRow(await supabase.from("courses").insert(toCourseRecord(input)).select().single(), {
        conflict: DUPLICATE_COURSE_MESSAGE,
        failure: "Failed to create course",
      }),
    insertLinks: async (course) => {
      unwrapCompleted(
        await supabase.from("course_teachers").insert(
          input.teacherIds.map((teacher_id) => ({
            plan_id: input.planId,
            course_id: course.id,
            teacher_id,
          })),
        ),
        "Failed to assign teachers",
      );
    },
    deleteParent: async (course) => {
      const { error } = await supabase.from("courses").delete().eq("id", course.id);
      if (error) {
        // Double fault: the link insert failed AND its compensating cleanup failed,
        // leaving an orphan course. Surface it for tracing — the original link error
        // is still rethrown to the caller by writeParentWithLinks.
        // eslint-disable-next-line no-console
        console.error(`[createCourse] orphan course ${course.id} left after failed cleanup: ${error.message}`);
      }
    },
  });
