import type { CourseInput } from "../model/schemas";

/**
 * Map camelCase course input to its snake_case `courses` row shape (create and update).
 * Teachers live in the `course_teachers` junction (written separately), not on this row.
 */
export const toCourseRecord = (input: CourseInput) => ({
  plan_id: input.planId,
  cohort: input.cohort,
  name: input.name,
  level: input.level,
  group_index: input.groupIndex,
  hours_per_week: input.hoursPerWeek,
  week_mode: input.weekMode,
  color: input.color,
  finishes_early: input.finishesEarly,
});
