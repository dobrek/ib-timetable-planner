const CIRCLED_DIGITS = ["", "①", "②", "③"] as const;

/** Compact course badge label: name + level (unless "none") + circled group-index suffix when > 0. */
export function formatCourseBadgeLabel(course: { name: string; level: string; groupIndex: number }): string {
  const levelPart = course.level !== "none" ? ` ${course.level}` : "";
  const groupSuffix =
    course.groupIndex > 0 && course.groupIndex < CIRCLED_DIGITS.length ? CIRCLED_DIGITS[course.groupIndex] : "";
  return `${course.name}${levelPart}${groupSuffix}`;
}

/** Badge label from a raw catalog row — bridges the DB `group_index` to {@link formatCourseBadgeLabel}. */
export function formatCourseRowBadgeLabel(row: { name: string; level: string; group_index: number }): string {
  return formatCourseBadgeLabel({ name: row.name, level: row.level, groupIndex: row.group_index });
}
