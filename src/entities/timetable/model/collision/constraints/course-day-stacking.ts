import type { PlacementWeek } from "@/shared/config";
import { lanesOf, type WeekLane } from "../../analysis/lanes";
import { courseDayPeriods, type DayOccupancyIndex } from "../../day-occupancy-index";
import { distinctById } from "./distinct-by-id";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Warn-level daily spread cap: at most 2 periods of one course per day in any given fortnightly
 * week. A third same-day period in a concrete week (A or B) warns; two stay silent.
 *
 * Week-aware (Critical Implementation Details): a course's placements are tallied per concrete
 * week, with a `both` (agnostic) placement counting toward each. For a cell's course `c` on week
 * `w`, we warn when some concrete week `c` runs at this cell (A, B, or — for a `both` cell — both)
 * has ≥ 3 of `c`'s placements running it. Because the count comes from the day index, every
 * participating cell of that day evaluates the same tally and warns in lockstep.
 *
 * Applies to ALL courses (not gated by the early-finish flag). Board-only (no `test`) — invisible
 * to grouping enumeration; returns `[]` until the context carries the day-occupancy index.
 */
export const courseDayStacking: CellConstraint = {
  id: "course-day-stacking",
  explain: (occupants, ctx): CollisionViolation[] => {
    const index = ctx.dayOccupancy;
    if (!index) return [];
    const { day } = ctx.cell;
    const weekOf = (courseId: string): PlacementWeek => ctx.weekByCourseId?.get(courseId) ?? "both";

    return distinctById(occupants).flatMap((course): CollisionViolation[] => {
      const stack = stackedLanes(index, course.id, day, weekOf(course.id));
      return stack ? [{ kind: "course-day-stacking", courseIds: [course.id], ...stack }] : [];
    });
  },
};

/** The rule itself: more than 2 periods of one course in ONE day-week lane. Exported so
 *  `verifyGeneration`'s delta mirrors the oracle rather than restating the cap. */
export const exceedsDayCap = (periods: number[]): boolean => periods.length > DAY_CAP;

const DAY_CAP = 2;

/**
 * The breach, or null when no concrete week this cell runs reaches 3 periods of the course that day.
 * `count` is the worst lane's size (what the dialog reads); `lanes` names EVERY offending one, for
 * the same reason `course-day-split` does — `verifyGeneration` reads the delta per lane.
 */
const stackedLanes = (
  index: DayOccupancyIndex,
  courseId: string,
  day: number,
  week: PlacementWeek,
): { count: number; lanes: WeekLane[] } | null => {
  const stacks = lanesOf(week)
    .map((lane) => ({ lane, periods: courseDayPeriods(index, courseId, day, lane) }))
    .filter(({ periods }) => exceedsDayCap(periods));
  if (stacks.length === 0) return null;
  return { count: Math.max(...stacks.map(({ periods }) => periods.length)), lanes: stacks.map(({ lane }) => lane) };
};
