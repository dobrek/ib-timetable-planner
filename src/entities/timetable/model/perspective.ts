import type { AvailabilitySeverity } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { AvailabilityIndex } from "./availability-index";
import { buildCellCollisions, type CellCollisions } from "./collision/collisions";
import type { CollisionViolation } from "./collision/constraints";
import type { PlannerPlacement } from "./placement";

/**
 * The pure filtering/narrowing layer between full board data and a single-person
 * perspective view (a timetable seen through one teacher or one student). The membership
 * predicates are persona-symmetric; the *collision* helpers below stay teacher-specific
 * by design and follow derive-then-narrow: compute from the FULL cohort inputs first
 * (placements, availability, sibling cross-cohort index), then narrow — pre-filtering the
 * inputs would silently drop student-overlap and cross-cohort conflicts with other
 * teachers' courses.
 */

/** Courses the teacher conducts — `teacherKeys` membership (the lens predicate). */
export const teacherCourses = (courses: GroupingCourse[], teacherKey: string): GroupingCourse[] =>
  courses.filter((course) => course.teacherKeys.includes(teacherKey));

/** Courses the student attends — `studentKeys` membership (the student mirror of `teacherCourses`). */
export const studentCourses = (courses: GroupingCourse[], studentKey: string): GroupingCourse[] =>
  courses.filter((course) => course.studentKeys.includes(studentKey));

/** The person's occupied cells: placements of their courses (either persona's id set). */
export const perspectivePlacements = (
  placements: PlannerPlacement[],
  courseIds: ReadonlySet<string>,
): PlannerPlacement[] => placements.filter((placement) => courseIds.has(placement.courseId));

/**
 * Narrow a full-board violation map to the cells/violations involving the teacher:
 * violations citing one of the teacher's courses, or naming the teacher directly
 * (`teacherKey`-carrying kinds). Each kept cell's blocking/warning/unavailable sets are
 * rebuilt from the surviving violations via `buildCellCollisions`, so severities are
 * preserved exactly; cells left with no violations are dropped.
 */
export const narrowViolationsToTeacher = (
  violations: Map<string, CellCollisions>,
  teacherKey: string,
  teacherCourseIds: ReadonlySet<string>,
): Map<string, CellCollisions> => {
  const involvesTeacher = (violation: CollisionViolation): boolean =>
    ("teacherKey" in violation && violation.teacherKey === teacherKey) ||
    citedCourseIds(violation).some((id) => teacherCourseIds.has(id));

  const narrowed = new Map<string, CellCollisions>();
  for (const [key, cell] of violations) {
    const kept = cell.violations.filter(involvesTeacher);
    if (kept.length > 0) narrowed.set(key, buildCellCollisions(kept));
  }
  return narrowed;
};

/**
 * The teacher's blocked cells for empty-slot shading: `cellKey` → severity. Strong wins
 * when both severities mark the same cell. (Occupied-cell availability conflicts surface
 * through the violation map; this covers the empty slots the board never shades today.)
 */
export const teacherUnavailableCells = (
  index: AvailabilityIndex,
  teacherKey: string,
): Map<string, AvailabilitySeverity> => {
  const cells = new Map<string, AvailabilitySeverity>();
  for (const key of index.softUnavailableByTeacher.get(teacherKey) ?? []) cells.set(key, "soft");
  for (const key of index.strongUnavailableByTeacher.get(teacherKey) ?? []) cells.set(key, "strong");
  return cells;
};

const citedCourseIds = (violation: CollisionViolation): string[] =>
  violation.kind === "duplicate-course" ? [violation.courseId] : violation.courseIds;
