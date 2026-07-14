import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { courseDaySplit } from "./course-day-split";
import { courseDayStacking } from "./course-day-stacking";
import { crossCohortTeacher } from "./cross-cohort-teacher";
import { duplicateCourse } from "./duplicate-course";
import { earlyFinishEdge } from "./early-finish-edge";
import { studentConflict } from "./student-conflict";
import { teacherAvailability } from "./teacher-availability";
import { teacherConflict } from "./teacher-conflict";
import { teacherDayShape } from "./teacher-day-shape";
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
  courseDaySplit,
  teacherDayShape,
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
// The two expert-hard rules' predicates + bounds: the oracle owns the definition, and the engine's
// `fitsAt` fast path mirrors it by importing these rather than restating them.
export { hasDaySplit } from "./course-day-split";
export {
  exceedsTeacherDayShape,
  teacherDayPeriods,
  TEACHER_DAY_SPAN_MAX,
  TEACHER_STREAK_MAX,
} from "./teacher-day-shape";
