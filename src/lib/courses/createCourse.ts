import type { CourseInput } from "../schemas/course";
import { DomainError } from "../errors";
import { DUPLICATE_COURSE_MESSAGE, UNIQUE_VIOLATION, type Supabase } from "./shared";

/** Insert a single atomic course. */
export const createCourse = async (supabase: Supabase, input: CourseInput) => {
  const { data, error } = await supabase
    .from("courses")
    .insert({
      cohort_id: input.cohortId,
      teacher_id: input.teacherId,
      name: input.name,
      level: input.level,
      group_index: input.groupIndex,
      hours_per_week: input.hoursPerWeek,
    })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    throw new DomainError("CONFLICT", DUPLICATE_COURSE_MESSAGE);
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create course: ${error.message}`);
  }
  return data;
};
