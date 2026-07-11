import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { courseDayStacking } from "./course-day-stacking";
import { crossCohortTeacher } from "./cross-cohort-teacher";
import { duplicateCourse } from "./duplicate-course";
import { earlyFinishEdge } from "./early-finish-edge";
import { studentConflict } from "./student-conflict";
import { teacherAvailability } from "./teacher-availability";
import { teacherConflict } from "./teacher-conflict";
import type { BoardContext, CellConstraint, CollisionViolation } from "./types";

/** Single registration point — adding a constraint touches only this array. */
export const CELL_CONSTRAINTS: CellConstraint[] = [
  duplicateCourse,
  teacherConflict,
  studentConflict,
  teacherAvailability,
  crossCohortTeacher,
  earlyFinishEdge,
  courseDayStacking,
];

/** Enumerates every violation in a cell across all registered constraints. */
export const explainCell = (occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[] =>
  CELL_CONSTRAINTS.flatMap((constraint) => constraint.explain(occupants, ctx));

/**
 * Short-circuiting boolean verdict over the registry's ctx-free fast paths.
 * Constraints without `test` (board-only) do not participate.
 */
export const violatesAny = (course: GroupingCourse, others: GroupingCourse[]): boolean =>
  CELL_CONSTRAINTS.some((constraint) => constraint.test?.(course, others) ?? false);

export type { BoardContext, CellConstraint, CollisionViolation } from "./types";
