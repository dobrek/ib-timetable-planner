const CIRCLED_DIGITS = ["", "①", "②", "③"] as const;

/** Compact course badge label: name + level (unless "none") + circled group-index suffix when > 0. */
export function formatCourseBadgeLabel(course: { name: string; level: string; groupIndex: number }): string {
  const levelPart = course.level !== "none" ? ` ${course.level}` : "";
  const groupSuffix =
    course.groupIndex > 0 && course.groupIndex < CIRCLED_DIGITS.length ? CIRCLED_DIGITS[course.groupIndex] : "";
  return `${course.name}${levelPart}${groupSuffix}`;
}
