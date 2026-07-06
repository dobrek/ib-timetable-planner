import type { Cohort } from "@/shared/config";
import type { CourseMerge } from "@/shared/api";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { HoursStat } from "./hours";
import type { PlannerPlacement } from "./placement";

/**
 * One row of a person's course list — always a REAL course: merge-parent composites are
 * resolved to their children (each with its own roster), mirroring the choice-picker
 * precedent that composites are scheduling artifacts. A child absent from the grouping
 * catalog (no direct student choices) still gets a row with an empty roster.
 */
export type PerspectiveCourseItem = {
  courseId: string;
  cohort: Cohort;
  /** Placements that schedule this course — the composite parent's for a merge child. */
  occurrences: PlannerPlacement[];
  /** Hours placed/required (`deriveHours` stat); a merge child falls back to its parent's. */
  hours: HoursStat | null;
  /** The FULL teacher set (a catalog-absent merge child falls back to its parent's). */
  teacherKeys: string[];
  studentKeys: string[];
  /** Set on a merge child: the composite parent whose single block carries it on the grid. */
  mergedIntoId?: string;
};

/**
 * Build one cohort's course-list rows for a person: filter the catalog by the `memberOf`
 * predicate (the only persona input — teacher-set or student-set membership), resolve
 * merge parents to children, attach occurrences (sorted by day, then period) and hours.
 * Children are skipped as standalone entries when their parent is also the person's
 * (merges require identical teacher sets, so the parent row covers them). Persona UIs
 * derive their "people" lines from the raw `teacherKeys`/`studentKeys` at render.
 */
export const buildPerspectiveCourseItems = (input: {
  cohort: Cohort;
  courses: GroupingCourse[];
  placements: PlannerPlacement[];
  merges: CourseMerge[];
  hours: Map<string, HoursStat>;
  memberOf: (course: GroupingCourse) => boolean;
}): PerspectiveCourseItem[] => {
  const { cohort, courses, placements, merges, hours, memberOf } = input;
  const catalogById = new Map(courses.map((course) => [course.id, course]));
  const mine = courses.filter(memberOf);
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

  const toItem = (course: GroupingCourse): PerspectiveCourseItem => ({
    courseId: course.id,
    cohort,
    occurrences: occurrencesOf(course.id),
    hours: hours.get(course.id) ?? null,
    teacherKeys: course.teacherKeys,
    studentKeys: course.studentKeys,
  });

  const toChildItem = (childId: string, parent: GroupingCourse): PerspectiveCourseItem => {
    const child = catalogById.get(childId);
    return {
      courseId: childId,
      cohort,
      // A merged session occupies the grid as the parent's one block, so the parent's
      // placements schedule the child — unioned with any standalone placements the child
      // carries itself (legitimate for partially-merged courses).
      occurrences: [...occurrencesOf(childId), ...occurrencesOf(parent.id)].sort(byDayThenPeriod),
      hours: (child && hours.get(childId)) ?? hours.get(parent.id) ?? null,
      teacherKeys: (child ?? parent).teacherKeys,
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
