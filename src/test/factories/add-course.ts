import type { Database, SupabaseClient } from "@/shared/api";
import type { WeekMode } from "@/shared/config";

export type AddCourseInput = {
  planId: string;
  cohort: Database["public"]["Enums"]["cohort"];
  name: string;
  level?: string;
  groupIndex?: number;
  hoursPerWeek: number;
  weekMode?: WeekMode;
  finishesEarly?: boolean;
  /** Teachers to link through the `course_teachers` junction (the source of `teacherKeys`). */
  teacherIds?: string[];
};

/**
 * Insert one `courses` row plus its `course_teachers` links, and return its id. The direct-insert
 * counterpart of `createCourse` for suites that build a bare topology (a handful of courses with a
 * chosen overlap/merge shape) instead of seeding the whole CSV catalog.
 */
export async function addCourse(supabase: SupabaseClient, input: AddCourseInput): Promise<{ courseId: string }> {
  const { data, error } = await supabase
    .from("courses")
    .insert({
      plan_id: input.planId,
      cohort: input.cohort,
      name: input.name,
      level: input.level ?? "none",
      group_index: input.groupIndex ?? 0,
      hours_per_week: input.hoursPerWeek,
      week_mode: input.weekMode ?? "agnostic",
      finishes_early: input.finishesEarly ?? false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`addCourse: ${error.message}`);

  const teacherIds = input.teacherIds ?? [];
  if (teacherIds.length > 0) {
    const links = teacherIds.map((teacher_id) => ({ plan_id: input.planId, course_id: data.id, teacher_id }));
    const { error: linkError } = await supabase.from("course_teachers").insert(links);
    if (linkError) throw new Error(`addCourse: course_teachers: ${linkError.message}`);
  }
  return { courseId: data.id };
}
