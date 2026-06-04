import type { GroupingCourse } from "./types";

export const hasIntersection = (course: GroupingCourse, list: GroupingCourse[]): boolean => {
  if (list.some((item) => item.id === course.id)) return true;

  if (
    course.teacherKey !== null &&
    list.some((item) => item.teacherKey !== null && item.teacherKey === course.teacherKey)
  )
    return true;

  return list.some((item) => item.studentKeys.some((s) => course.studentKeys.includes(s)));
};
