import type { PlacementWeek } from "@/shared/config";
import { lanesOf, laneStats, type WeekLane } from "../../analysis/lanes";
import { courseDayPeriods, type DayOccupancyIndex } from "../../day-occupancy-index";
import { distinctById } from "./distinct-by-id";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * The expert's first inviolable rule (R1): **a course's hours on one day must be consecutive**.
 * Two hours of Math at P2 and P5 is a "split block" — refused outright, *even at the cost of an
 * extra slot or an unplaced hour*. The lunch break counts like any other break: the rule is about
 * the period sequence, not about what sits between the periods.
 *
 * Warn severity here, so manual editing stays possible (the `course-day-stacking` precedent), but
 * **generator-hard**: `verifyGeneration` escalates it to a failure whenever a generated placement
 * participates, and `board.fitsAt` rejects any placement that would create one.
 *
 * Week-aware, per the `lanes.ts` conventions: periods are read per concrete fortnightly week (a
 * `both` placement runs in each), so a week-A hour at P2 and a week-B hour at P5 are two separate
 * lanes and no split. Day-scoped via `ctx.dayOccupancy` like `course-day-stacking`, so every cell of
 * the offending day flags in lockstep. Board-only (no `test`) — invisible to grouping enumeration.
 */
export const courseDaySplit: CellConstraint = {
  id: "course-day-split",
  explain: (occupants, ctx): CollisionViolation[] => {
    const index = ctx.dayOccupancy;
    if (!index) return [];
    const { day } = ctx.cell;
    const weekOf = (courseId: string): PlacementWeek => ctx.weekByCourseId?.get(courseId) ?? "both";

    return distinctById(occupants).flatMap((course): CollisionViolation[] => {
      const split = splitLanes(index, course.id, day, weekOf(course.id));
      return split ? [{ kind: "course-day-split", courseIds: [course.id], ...split }] : [];
    });
  },
};

/** The rule itself: periods within ONE day-week lane that are not consecutive. Exported because
 *  the engine's `fitsAt` guard and `verifyGeneration`'s delta mirror the oracle rather than
 *  restating it. */
export const hasDaySplit = (periods: number[]): boolean => {
  const { count, span } = laneStats(periods);
  return count >= 2 && span > count;
};

/**
 * The breach, or null when the course is consecutive in every concrete week this cell runs.
 * `periods` shows the first offending lane (what the dialog reads); `lanes` names EVERY offending
 * one, because `verifyGeneration` reads the delta lane-by-lane against the pins-only board — a
 * lane-blind key cannot tell a week-B hour the generator placed from a week-A split the author
 * pinned, and rejects the whole board for the latter.
 */
const splitLanes = (
  index: DayOccupancyIndex,
  courseId: string,
  day: number,
  week: PlacementWeek,
): { periods: number[]; lanes: WeekLane[] } | null => {
  const splits = lanesOf(week)
    .map((lane) => ({ lane, periods: courseDayPeriods(index, courseId, day, lane) }))
    .filter(({ periods }) => hasDaySplit(periods));
  if (splits.length === 0) return null;
  return { periods: splits[0].periods, lanes: splits.map(({ lane }) => lane) };
};
