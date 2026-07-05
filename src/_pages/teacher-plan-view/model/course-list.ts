import type { Cohort } from "@/shared/config";
import type { CourseMerge } from "@/shared/api";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { teacherCourses, type HoursStat, type PlannerPlacement } from "@/entities/timetable";

/**
 * One row of the teacher's course list — always a REAL course: merge-parent composites are
 * resolved to their children (each with its own roster), mirroring the choice-picker
 * precedent that composites are scheduling artifacts. A child absent from the grouping
 * catalog (no direct student choices) still gets a row with an empty roster.
 */
export type TeacherCourseItem = {
  courseId: string;
  cohort: Cohort;
  /** Placements that schedule this course — the composite parent's for a merge child. */
  occurrences: PlannerPlacement[];
  /** Hours placed/required (`deriveHours` stat); a merge child falls back to its parent's. */
  hours: HoursStat | null;
  /** The other members of the course's teacher set (the current teacher excluded). */
  coTeacherKeys: string[];
  studentKeys: string[];
  /** Set on a merge child: the composite parent whose single block carries it on the grid. */
  mergedIntoId?: string;
};

/**
 * Build one cohort's course-list rows for a teacher: filter the catalog by teacher-set
 * membership, resolve merge parents to children, attach occurrences (sorted by day, then
 * period) and hours. Children are skipped as standalone entries when their parent is also
 * the teacher's (merges require identical teacher sets, so the parent row covers them).
 */
export const buildTeacherCourseItems = (input: {
  cohort: Cohort;
  courses: GroupingCourse[];
  placements: PlannerPlacement[];
  merges: CourseMerge[];
  hours: Map<string, HoursStat>;
  teacherKey: string;
}): TeacherCourseItem[] => {
  const { cohort, courses, placements, merges, hours, teacherKey } = input;
  const catalogById = new Map(courses.map((course) => [course.id, course]));
  const mine = teacherCourses(courses, teacherKey);
  const mineIds = new Set(mine.map((course) => course.id));
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const merge of merges) {
    if (!mineIds.has(merge.parentId)) continue;
    childrenOf.set(merge.parentId, [...(childrenOf.get(merge.parentId) ?? []), merge.childId]);
    parentOf.set(merge.childId, merge.parentId);
  }

  const occurrencesOf = (courseId: string): PlannerPlacement[] =>
    placements.filter((placement) => placement.courseId === courseId).sort(byDayThenPeriod);

  const toItem = (course: GroupingCourse): TeacherCourseItem => ({
    courseId: course.id,
    cohort,
    occurrences: occurrencesOf(course.id),
    hours: hours.get(course.id) ?? null,
    coTeacherKeys: course.teacherKeys.filter((key) => key !== teacherKey),
    studentKeys: course.studentKeys,
  });

  const toChildItem = (childId: string, parent: GroupingCourse): TeacherCourseItem => {
    const child = catalogById.get(childId);
    return {
      courseId: childId,
      cohort,
      // A merged session occupies the grid as the parent's one block, so the parent's
      // placements schedule the child — unioned with any standalone placements the child
      // carries itself (legitimate for partially-merged courses).
      occurrences: [...occurrencesOf(childId), ...occurrencesOf(parent.id)].sort(byDayThenPeriod),
      hours: (child && hours.get(childId)) ?? hours.get(parent.id) ?? null,
      coTeacherKeys: (child ?? parent).teacherKeys.filter((key) => key !== teacherKey),
      studentKeys: child?.studentKeys ?? [],
      mergedIntoId: parent.id,
    };
  };

  return mine.flatMap((course) => {
    const childIds = childrenOf.get(course.id);
    if (childIds) return childIds.map((childId) => toChildItem(childId, course));
    // A child with direct choices sits in the catalog as a real course; its parent's
    // resolution above already covers it — skip the standalone duplicate.
    if (parentOf.has(course.id)) return [];
    return [toItem(course)];
  });
};

const byDayThenPeriod = (a: PlannerPlacement, b: PlannerPlacement): number =>
  a.day !== b.day ? a.day - b.day : a.period - b.period;
