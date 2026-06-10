import { LEVEL_NONE, type CourseRow } from "../model/course";
import { COURSE_GROUP_INDICES, isCourseGroupIndex, type CourseGroupIndex } from "../model/schemas";

/**
 * Human-readable course label: name, plus level (unless "none") and group (unless 0).
 * e.g. "German B (SL) · Group 1", "Mathematics", "Spanish B (AB+SL)".
 */
export function formatCourseLabel(course: Pick<CourseRow, "name" | "level" | "groupIndex">): string {
  const parts = [course.name];
  if (course.level !== LEVEL_NONE) parts.push(`(${course.level})`);
  if (course.groupIndex !== 0) parts.push(`· Group ${course.groupIndex}`);
  return parts.join(" ");
}

/** Group table-cell label: "—" for the 0/none sentinel, "Group N" for known groups, raw otherwise. */
export function formatGroupCell(groupIndex: number): string {
  if (groupIndex === 0) return "—";
  return isCourseGroupIndex(groupIndex) ? GROUP_INDEX_LABELS[groupIndex] : String(groupIndex);
}

/** Authoring labels for the canonical group indices; 0 is the "none" sentinel. */
export const GROUP_INDEX_LABELS: Record<CourseGroupIndex, string> = {
  0: "None",
  1: "Group 1",
  2: "Group 2",
  3: "Group 3",
};

/** Select options for the group field, derived from the canonical indices. */
export const GROUP_OPTIONS: { value: CourseGroupIndex; label: string }[] = COURSE_GROUP_INDICES.map((value) => ({
  value,
  label: GROUP_INDEX_LABELS[value],
}));
