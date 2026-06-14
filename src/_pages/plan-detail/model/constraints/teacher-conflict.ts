import { groupByInto } from "@/shared/lib/collections";
import type { CellConstraint } from "./types";

/**
 * Occupants sharing a non-null `teacherKey` — one violation per teacher with ≥2
 * courses, carrying all member course ids. Null teachers never conflict.
 */
export const teacherConflict: CellConstraint = {
  id: "teacher-conflict",
  explain: (occupants) =>
    [
      ...groupByInto(
        occupants,
        (course) => course.teacherKey,
        (course) => course,
        { skipNullKeys: true },
      ),
    ]
      .filter(([, members]) => members.length >= 2)
      .map(([teacherKey, members]) => ({ kind: "teacher", teacherKey, courseIds: members.map((m) => m.id) })),
  test: (course, others) =>
    course.teacherKey !== null &&
    others.some((item) => item.teacherKey !== null && item.teacherKey === course.teacherKey),
};
