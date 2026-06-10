import type { CourseInput } from "../model/schemas";

/** Map camelCase course input to its snake_case `courses` row shape (create and update). */
export const toCourseRecord = (input: CourseInput) => ({
  cohort_id: input.cohortId,
  teacher_id: input.teacherId,
  name: input.name,
  level: input.level,
  group_index: input.groupIndex,
  hours_per_week: input.hoursPerWeek,
});
