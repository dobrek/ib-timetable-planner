import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { PlannerPlacement } from "./placement";

/**
 * A week-aware, per-day view of the board that the two day-scoped rules read. Built once per
 * derivation over `(placements, catalogById)` — the same set the constraint core already
 * consumes — and handed to `deriveCellViolations` via `BoardContext`. Follows the
 * `availability-index` / `cross-cohort-index` builder pattern (an exported empty constant plus a
 * pure builder). Entries carry their placement `week`; consumers do the week-overlap filtering via
 * the shared `weeksDisjoint` primitive, so no week semantics are baked in here.
 */

/** One period a student occupies on a day, tagged with its source course (to exclude self). */
export type StudentDayEntry = { period: number; week: PlacementWeek; courseId: string };

/** One placement of a course on a day (period + week), for the same-day stacking count. */
export type CourseDayEntry = { period: number; week: PlacementWeek };

export type DayOccupancyIndex = {
  /** studentKey → day → the periods that student occupies (via each of their enrolled courses). */
  byStudentDay: Map<string, Map<number, StudentDayEntry[]>>;
  /** courseId → day → that course's placements on the day. */
  byCourseDay: Map<string, Map<number, CourseDayEntry[]>>;
};

export const EMPTY_DAY_OCCUPANCY_INDEX: DayOccupancyIndex = {
  byStudentDay: new Map(),
  byCourseDay: new Map(),
};

/**
 * O(rows × students-per-course) build. A placement whose course is absent from the catalog is
 * skipped (cannot attribute its students), mirroring `bucketByCell`.
 */
export const buildDayOccupancyIndex = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): DayOccupancyIndex => {
  const byStudentDay = new Map<string, Map<number, StudentDayEntry[]>>();
  const byCourseDay = new Map<string, Map<number, CourseDayEntry[]>>();
  for (const placement of placements) {
    const course = catalogById.get(placement.courseId);
    if (!course) continue;
    pushByDay(byCourseDay, course.id, placement.day, { period: placement.period, week: placement.week });
    for (const studentKey of course.studentKeys) {
      pushByDay(byStudentDay, studentKey, placement.day, {
        period: placement.period,
        week: placement.week,
        courseId: course.id,
      });
    }
  }
  return { byStudentDay, byCourseDay };
};

const pushByDay = <T>(index: Map<string, Map<number, T[]>>, key: string, day: number, entry: T): void => {
  const byDay = index.get(key) ?? new Map<number, T[]>();
  if (!index.has(key)) index.set(key, byDay);
  const entries = byDay.get(day) ?? [];
  if (!byDay.has(day)) byDay.set(day, entries);
  entries.push(entry);
};
