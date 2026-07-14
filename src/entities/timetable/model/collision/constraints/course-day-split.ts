import type { PlacementWeek } from "@/shared/config";
import { lanesOf, laneStats } from "../../analysis/lanes";
import type { DayOccupancyIndex } from "../../day-occupancy-index";
import { weeksDisjoint } from "../../week";
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
      const split = splitPeriods(index, course.id, day, weekOf(course.id));
      return split ? [{ kind: "course-day-split", courseIds: [course.id], periods: split }] : [];
    });
  },
};

/** The rule itself: periods within ONE day-week lane that are not consecutive. Exported because
 *  the engine's `fitsAt` guard mirrors the oracle rather than restating it. */
export const hasDaySplit = (periods: number[]): boolean => {
  const { count, span } = laneStats(periods);
  return count >= 2 && span > count;
};

/** The offending period set (ascending) of the first split among the concrete weeks this cell runs,
 *  or null when the course is consecutive in every one of them. */
const splitPeriods = (
  index: DayOccupancyIndex,
  courseId: string,
  day: number,
  week: PlacementWeek,
): number[] | null => {
  const entries = index.byCourseDay.get(courseId)?.get(day) ?? [];
  const splits = lanesOf(week)
    .map((lane) => entries.filter((entry) => !weeksDisjoint(entry.week, lane)).map((entry) => entry.period))
    .filter(hasDaySplit)
    .map((periods) => [...new Set(periods)].sort((a, b) => a - b));
  return splits.length > 0 ? splits[0] : null;
};
