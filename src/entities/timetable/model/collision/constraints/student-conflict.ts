import { weeksDisjoint } from "../../week";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Each unordered occupant pair with a non-empty `studentKeys` intersection — one
 * violation per pair, carrying the shared student ids. Week-aware (pairwise, so a clean
 * per-pair skip): an opposite-week (A/B) pair never collides even when it shares students.
 * The ctx-free `test()` fast path is week-blind and unchanged.
 */
export const studentConflict: CellConstraint = {
  id: "student-conflict",
  explain: (occupants, ctx) => {
    const weekOf = (courseId: string) => ctx.weekByCourseId?.get(courseId) ?? "both";
    const violations: CollisionViolation[] = [];
    for (let i = 0; i < occupants.length; i++) {
      for (let j = i + 1; j < occupants.length; j++) {
        if (weeksDisjoint(weekOf(occupants[i].id), weekOf(occupants[j].id))) continue;
        const studentKeys = sharedStudents(occupants[i], occupants[j]);
        if (studentKeys.length > 0)
          violations.push({ kind: "student", studentKeys, courseIds: [occupants[i].id, occupants[j].id] });
      }
    }
    return violations;
  },
  test: (course, others) => others.some((item) => item.studentKeys.some((s) => course.studentKeys.includes(s))),
};

const sharedStudents = (a: GroupingCourse, b: GroupingCourse): string[] =>
  a.studentKeys.filter((s) => b.studentKeys.includes(s));
