import type { GroupingCourse } from "../grouping";
import type { CellConstraint } from "./types";

/**
 * Occupants sharing a non-null `teacherKey` — one violation per teacher with ≥2
 * courses, carrying all member course ids. Null teachers never conflict.
 */
export const teacherConflict: CellConstraint = {
  id: "teacher-conflict",
  explain: (occupants) =>
    [...groupByTeacher(occupants)]
      .filter(([, members]) => members.length >= 2)
      .map(([teacherKey, members]) => ({ kind: "teacher", teacherKey, courseIds: members.map((m) => m.id) })),
  test: (course, others) =>
    course.teacherKey !== null &&
    others.some((item) => item.teacherKey !== null && item.teacherKey === course.teacherKey),
};

const groupByTeacher = (occupants: GroupingCourse[]): Map<string, GroupingCourse[]> => {
  const groups = new Map<string, GroupingCourse[]>();
  for (const course of occupants) {
    if (course.teacherKey === null) continue;
    const members = groups.get(course.teacherKey);
    if (members) members.push(course);
    else groups.set(course.teacherKey, [course]);
  }
  return groups;
};
