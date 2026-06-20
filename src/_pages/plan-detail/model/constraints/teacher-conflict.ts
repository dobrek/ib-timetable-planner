import type { CellConstraint } from "./types";

/**
 * Occupants whose teacher *sets* intersect — one violation per teacher co-taught by
 * ≥2 courses in the cell, carrying all member course ids. A course carries a set of
 * equal co-teachers (`teacherKeys`); an empty set never conflicts (no null guard, the
 * studentKeys blueprint). Each violation still names a single teacher, so the render
 * path is unchanged.
 */
export const teacherConflict: CellConstraint = {
  id: "teacher-conflict",
  explain: (occupants) => {
    const courseIdsByTeacher = new Map<string, string[]>();
    for (const course of occupants)
      for (const teacherKey of course.teacherKeys) {
        const ids = courseIdsByTeacher.get(teacherKey);
        if (ids) ids.push(course.id);
        else courseIdsByTeacher.set(teacherKey, [course.id]);
      }
    return [...courseIdsByTeacher.entries()]
      .filter(([, courseIds]) => courseIds.length >= 2)
      .map(([teacherKey, courseIds]) => ({ kind: "teacher", teacherKey, courseIds }));
  },
  test: (course, others) =>
    others.some((item) => item.teacherKeys.some((teacherKey) => course.teacherKeys.includes(teacherKey))),
};
