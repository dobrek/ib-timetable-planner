import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { weeksDisjoint } from "../../week";
import type { DayOccupancyIndex } from "../../day-occupancy-index";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Blocking rule for `finishes_early` courses: a flagged course must sit at the first or last
 * period an enrolled student occupies that day, so when it stops running mid-year its students
 * start later / finish earlier instead of inheriting a mid-day hole.
 *
 * Per placement, per student, week-aware (Critical Implementation Details): for a flagged course
 * `F` at this cell on week `w`, and each student `s` in `F`, let `O` be the periods `s` occupies
 * this day via courses *other than* `F` whose week overlaps `w`. It is a violation for `s` unless
 * `O` is empty, or the cell's period `≤ min(O)`, or `≥ max(O)` — i.e. only strictly-interior
 * placements offend. Comparing against *other* courses' periods (not "first/last of all") lets a
 * legal edge double (F at 1–2 before others at 3–5) pass without self-violating.
 *
 * Board-only (no `test`): invisible to grouping enumeration, and returns `[]` until the context
 * carries both the flag set and the day-occupancy index (the regression path).
 */
export const earlyFinishEdge: CellConstraint = {
  id: "early-finish-edge",
  explain: (occupants, ctx) => {
    const flagged = ctx.finishesEarlyByCourseId;
    const index = ctx.dayOccupancy;
    if (!flagged || !index) return [];
    const { day, period } = ctx.cell;
    const weekOf = (courseId: string): PlacementWeek => ctx.weekByCourseId?.get(courseId) ?? "both";

    const violations: CollisionViolation[] = [];
    for (const course of distinctById(occupants)) {
      if (!flagged.has(course.id)) continue;
      const week = weekOf(course.id);
      const studentKeys = course.studentKeys.filter((studentKey) =>
        isInterior(index, studentKey, day, period, week, course.id),
      );
      if (studentKeys.length > 0) violations.push({ kind: "early-finish-edge", courseIds: [course.id], studentKeys });
    }
    return violations;
  },
};

/** True when `period` sits strictly between the earliest and latest OTHER period the student
 *  occupies this day (in a week overlapping the flagged placement's). Empty `O` ⇒ not interior. */
const isInterior = (
  index: DayOccupancyIndex,
  studentKey: string,
  day: number,
  period: number,
  week: PlacementWeek,
  flaggedCourseId: string,
): boolean => {
  const others = (index.byStudentDay.get(studentKey)?.get(day) ?? [])
    .filter((entry) => entry.courseId !== flaggedCourseId && !weeksDisjoint(entry.week, week))
    .map((entry) => entry.period);
  if (others.length === 0) return false;
  return period > Math.min(...others) && period < Math.max(...others);
};

/** First occurrence of each course id — a cell can hold a same-course duplicate. */
const distinctById = (occupants: GroupingCourse[]): GroupingCourse[] => {
  const seen = new Set<string>();
  return occupants.filter((course) => !seen.has(course.id) && Boolean(seen.add(course.id)));
};
