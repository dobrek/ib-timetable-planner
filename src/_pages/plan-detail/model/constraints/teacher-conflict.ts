import { weeksDisjoint } from "../week";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Occupants whose teacher *sets* intersect — one violation per teacher co-taught by
 * ≥2 courses in the cell that actually overlap by week. A course carries a set of equal
 * co-teachers (`teacherKeys`); an empty set never conflicts (no null guard, the
 * studentKeys blueprint). Each violation still names a single teacher, so the render
 * path is unchanged.
 *
 * Week-aware: a teacher conflicts only among its courses whose weeks are NOT disjoint.
 * An opposite-week (A/B) pair sharing a teacher does not collide; but `teacher-conflict`
 * is multi-course, so a `{both, a, b}` teacher still conflicts (the `both` course overlaps
 * both single-week ones). The reported `courseIds` lists only the overlapping courses.
 * The ctx-free `test()` fast path is week-blind and unchanged (enumeration classifies it).
 */
export const teacherConflict: CellConstraint = {
  id: "teacher-conflict",
  explain: (occupants, ctx) => {
    const weekOf = (courseId: string) => ctx.weekByCourseId?.get(courseId) ?? "both";

    const courseIdsByTeacher = new Map<string, string[]>();
    for (const course of occupants)
      for (const teacherKey of course.teacherKeys) {
        const ids = courseIdsByTeacher.get(teacherKey);
        if (ids) ids.push(course.id);
        else courseIdsByTeacher.set(teacherKey, [course.id]);
      }

    const violations: CollisionViolation[] = [];
    for (const [teacherKey, courseIds] of courseIdsByTeacher) {
      if (courseIds.length < 2) continue;
      // The courses participating in at least one week-overlapping pair (preserve order).
      const overlapping = new Set<string>();
      for (let i = 0; i < courseIds.length; i++)
        for (let j = i + 1; j < courseIds.length; j++)
          if (!weeksDisjoint(weekOf(courseIds[i]), weekOf(courseIds[j]))) {
            overlapping.add(courseIds[i]);
            overlapping.add(courseIds[j]);
          }
      if (overlapping.size >= 2)
        violations.push({ kind: "teacher", teacherKey, courseIds: courseIds.filter((id) => overlapping.has(id)) });
    }
    return violations;
  },
  test: (course, others) =>
    others.some((item) => item.teacherKeys.some((teacherKey) => course.teacherKeys.includes(teacherKey))),
};
