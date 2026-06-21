import { unwrapCompleted, unwrapMany, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { DeleteTeacherInput } from "../model/schemas";

/**
 * Delete a teacher, guarding the app-enforced "≥1 teacher per course" invariant: a teacher
 * who is the SOLE teacher of any course cannot be deleted (it would orphan that course to
 * zero teachers) — the deletion is blocked and the orphaned courses are named for
 * reassignment. Deleting one of several co-teachers is fine: the junction link just cascades.
 */
export const deleteTeacher = async (supabase: SupabaseClient, input: DeleteTeacherInput): Promise<void> => {
  const myLinks = unwrapMany(
    await supabase.from("course_teachers").select("course_id").eq("plan_id", input.planId).eq("teacher_id", input.id),
    "Failed to check teacher assignments",
  );

  const myCourseIds = myLinks.map((link) => link.course_id);
  if (myCourseIds.length > 0) {
    const courseLinks = unwrapMany(
      await supabase
        .from("course_teachers")
        .select("course_id")
        .eq("plan_id", input.planId)
        .in("course_id", myCourseIds),
      "Failed to check co-teachers",
    );
    const teacherCountByCourse = new Map<string, number>();
    for (const link of courseLinks)
      teacherCountByCourse.set(link.course_id, (teacherCountByCourse.get(link.course_id) ?? 0) + 1);

    const soleCourseIds = myCourseIds.filter((courseId) => (teacherCountByCourse.get(courseId) ?? 0) <= 1);
    if (soleCourseIds.length > 0) {
      const soleCourses = unwrapMany(
        await supabase
          .from("courses")
          .select("name, level, group_index")
          .eq("plan_id", input.planId)
          .in("id", soleCourseIds),
        "Failed to load orphaned courses",
      );
      const names = soleCourses.map(courseLabel).join(", ");
      throw new DomainError(
        "CONFLICT",
        `Only teacher on ${soleCourseIds.length} course${soleCourseIds.length === 1 ? "" : "s"} (${names}) — reassign or delete those courses first.`,
      );
    }
  }

  unwrapCompleted(
    await supabase.from("teachers").delete().eq("plan_id", input.planId).eq("id", input.id),
    "Failed to delete teacher",
  );
};

/** Compact human label for an orphaned course in the guard message. */
const courseLabel = (course: { name: string; level: string; group_index: number }): string => {
  const level = course.level === "none" ? "" : course.level;
  const group = course.group_index === 0 ? "" : `G${course.group_index}`;
  return [course.name, level, group].filter(Boolean).join(" ");
};
