import type { CourseRow } from "../model/course";

/**
 * Human-readable course label: name, plus level (unless "none") and group (unless 0).
 * e.g. "German B (SL) · Group 1", "Mathematics", "Spanish B (AB+SL)".
 */
export function formatCourseLabel(course: Pick<CourseRow, "name" | "level" | "groupIndex">): string {
  const parts = [course.name];
  if (course.level !== "none") parts.push(`(${course.level})`);
  if (course.groupIndex !== 0) parts.push(`· Group ${course.groupIndex}`);
  return parts.join(" ");
}
