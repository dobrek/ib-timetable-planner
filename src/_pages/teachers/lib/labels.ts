import type { CourseAssignment } from "../model/teacher";

const CIRCLED_DIGITS = ["", "①", "②", "③"] as const;

/** Badge label: course name + level + circled group-index suffix when > 0. */
export function formatAssignmentBadgeLabel(
  assignment: Pick<CourseAssignment, "name" | "level" | "groupIndex">,
): string {
  const levelPart = assignment.level !== "none" ? ` ${assignment.level}` : "";
  const groupSuffix =
    assignment.groupIndex > 0 && assignment.groupIndex < CIRCLED_DIGITS.length
      ? CIRCLED_DIGITS[assignment.groupIndex]
      : "";
  return `${assignment.name}${levelPart}${groupSuffix}`;
}
