import type { UpdateCourseInput } from "../schemas/course";
import { DomainError } from "../errors";
import { DUPLICATE_COURSE_MESSAGE, UNIQUE_VIOLATION, type Supabase } from "./shared";

/** Update an existing atomic course by id. */
export const updateCourse = async (supabase: Supabase, input: UpdateCourseInput) => {
  const { data, error } = await supabase
    .from("courses")
    .update({
      cohort_id: input.cohortId,
      teacher_id: input.teacherId,
      name: input.name,
      level: input.level,
      group_index: input.groupIndex,
      hours_per_week: input.hoursPerWeek,
    })
    .eq("id", input.id)
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new DomainError("CONFLICT", DUPLICATE_COURSE_MESSAGE);
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to update course: ${error.message}`);
  }
  return data;
};
