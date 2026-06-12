import type { GroupingCourse } from "../grouping";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Each unordered occupant pair with a non-empty `studentKeys` intersection — one
 * violation per pair, carrying the shared student ids.
 */
export const studentConflict: CellConstraint = {
  id: "student-conflict",
  explain: (occupants) => {
    const violations: CollisionViolation[] = [];
    for (let i = 0; i < occupants.length; i++) {
      for (let j = i + 1; j < occupants.length; j++) {
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
