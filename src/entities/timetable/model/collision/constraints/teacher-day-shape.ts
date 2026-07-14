import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { lanesOf, laneStats, type WeekLane } from "../../analysis/lanes";
import type { CrossCohortIndex } from "../../cross-cohort-index";
import type { DayOccupancyIndex } from "../../day-occupancy-index";
import { weeksDisjoint } from "../../week";
import { distinctById } from "./distinct-by-id";
import type { BoardContext, CellConstraint, CollisionViolation } from "./types";

/**
 * The expert's second inviolable rule (R2): **a teacher's working day is bounded** — it may span at
 * most 8 periods (labour law: an 8-hour working day, first bell to last), and may not contain a run
 * of more than 6 consecutive teaching hours ("max 6 in a row"). Both bounds were SQL-verified
 * gold-safe: the expert's board maxes out at exactly span 8 and a 6-run, while the engine's board
 * reaches span 10 and a 7-run — so the rule is discriminating without touching the gold plan.
 *
 * A teacher's day is ONE day across BOTH cohorts (16 of the 17 teachers teach in both), so the
 * period set unions this cohort's own placements (`ctx.dayOccupancy.byTeacherDay`) with the sibling
 * cohort's (`ctx.occupiedByTeacher`). Week-aware per the `lanes.ts` conventions: each concrete
 * fortnightly week is its own day.
 *
 * Warn severity (manual editing stays possible), generator-hard through `verifyGeneration` +
 * `board.fitsAt` — the `course-day-stacking` template. Board-only (no `test`).
 */
export const TEACHER_DAY_SPAN_MAX = 8;
export const TEACHER_STREAK_MAX = 6;

export const teacherDayShape: CellConstraint = {
  id: "teacher-day-shape",
  explain: (occupants, ctx): CollisionViolation[] => {
    const index = ctx.dayOccupancy;
    if (!index) return [];
    const { day } = ctx.cell;

    return [...teachersInCell(distinctById(occupants))].flatMap(([teacherKey, courseIds]) => {
      const shape = offendingLanes(index, ctx.occupiedByTeacher, teacherKey, day, cellLanes(courseIds, ctx));
      return shape ? [{ kind: "teacher-day-shape" as const, teacherKey, courseIds, ...shape }] : [];
    });
  },
};

/** The rule itself: a teacher day-lane that spans more than 8 periods or teaches more than 6 in a
 *  row. Exported because the engine's `fitsAt` guard mirrors the oracle rather than restating it. */
export const exceedsTeacherDayShape = (periods: number[]): boolean => {
  const { span, maxStreak } = laneStats(periods);
  return span > TEACHER_DAY_SPAN_MAX || maxStreak > TEACHER_STREAK_MAX;
};

/**
 * Every period a teacher works on one day of one concrete week, across BOTH cohorts: this cohort's
 * placements from the day index, the sibling's from the cross-cohort occupancy index. Exported for
 * the same mirror reason — the engine keeps its own two-cohort index, and both must agree on what
 * "a teacher's day" is.
 */
export const teacherDayPeriods = (
  index: DayOccupancyIndex,
  siblingOccupancy: CrossCohortIndex | undefined,
  teacherKey: string,
  day: number,
  lane: WeekLane,
): number[] => {
  const own = (index.byTeacherDay.get(teacherKey)?.get(day) ?? [])
    .filter((entry) => !weeksDisjoint(entry.week, lane))
    .map((entry) => entry.period);
  const sibling = [...(siblingOccupancy?.get(teacherKey) ?? new Map<string, Set<PlacementWeek>>())]
    .filter(([key, weeks]) => key.startsWith(`${day}:`) && [...weeks].some((week) => !weeksDisjoint(week, lane)))
    .map(([key]) => periodOf(key));
  return [...new Set([...own, ...sibling])];
};

/** teacherKey → the cell's courses that teacher teaches (the violation's `courseIds`). */
const teachersInCell = (occupants: GroupingCourse[]): Map<string, string[]> => {
  const byTeacher = new Map<string, string[]>();
  for (const course of occupants) {
    for (const teacherKey of course.teacherKeys) {
      byTeacher.set(teacherKey, [...(byTeacher.get(teacherKey) ?? []), course.id]);
    }
  }
  return byTeacher;
};

/** The concrete weeks this cell runs for the given courses (a `both` course runs in each). */
const cellLanes = (courseIds: string[], ctx: BoardContext): WeekLane[] => {
  const lanes = courseIds.flatMap((courseId) => lanesOf(ctx.weekByCourseId?.get(courseId) ?? "both"));
  return [...new Set(lanes)];
};

/**
 * The breach, or null when every lane the cell runs is legal. `span`/`maxStreak` describe the worst
 * lane (what the dialog shows); `lanes` names EVERY offending lane, because `verifyGeneration` reads
 * the delta lane-by-lane against the pins-only board — reporting only the worst lane would hide a
 * second, generator-created breach behind a pin-caused one.
 */
const offendingLanes = (
  index: DayOccupancyIndex,
  siblingOccupancy: CrossCohortIndex | undefined,
  teacherKey: string,
  day: number,
  candidateLanes: WeekLane[],
): { span: number; maxStreak: number; lanes: WeekLane[] } | null => {
  const offending = candidateLanes
    .map((lane) => ({ lane, ...laneStats(teacherDayPeriods(index, siblingOccupancy, teacherKey, day, lane)) }))
    .filter(({ span, maxStreak }) => span > TEACHER_DAY_SPAN_MAX || maxStreak > TEACHER_STREAK_MAX)
    .sort((a, b) => b.span - a.span || b.maxStreak - a.maxStreak);
  if (offending.length === 0) return null;
  return {
    span: offending[0].span,
    maxStreak: offending[0].maxStreak,
    lanes: offending.map(({ lane }) => lane),
  };
};

/** The period half of a `cellKey` (`${day}:${period}`) — the cross-cohort index is cell-keyed. */
const periodOf = (key: string): number => Number(key.split(":")[1]);
