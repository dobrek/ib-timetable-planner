import type { PlacementWeek } from "@/shared/config";

/**
 * The one primitive ~80% of the metric catalog folds over: placement rows expanded into
 * `(entityKey, day, weekLane)` lanes, where a `both`-week row fans into BOTH concrete lanes —
 * exactly what `countStudentHoles` does for students (`objective.ts:94`), lifted so students,
 * teachers, courses and cohorts all share one expansion.
 *
 * Week semantics are a per-metric choice, and this module makes it explicit: gap / adjacency /
 * streak metrics are lane-expanded (here); slot-census metrics (occupied slots, students-per-slot,
 * parallelism) count distinct `(day, period)` cells week-agnostically and do NOT use lanes.
 */

export type WeekLane = "a" | "b";

/** One entity's periods on one day of one week lane. Never empty — an entity with no rows has no lane. */
export type Lane = {
  entityKey: string;
  day: number;
  weekLane: WeekLane;
  /** Distinct periods, ascending. Two courses in the same period collapse into one entry — the
   *  student/teacher experiences one occupied hour, matching `countStudentHoles`. */
  periods: number[];
};

/** The fold every gap/adjacency/streak metric reads. `holes` is `span − count`. */
export type LaneStats = {
  count: number;
  first: number;
  last: number;
  span: number;
  holes: number;
  maxStreak: number;
};

const EMPTY_LANE_STATS: LaneStats = { count: 0, first: 0, last: 0, span: 0, holes: 0, maxStreak: 0 };

type LaneRow = { day: number; period: number; week: PlacementWeek };

/**
 * Expand rows into lanes. `keyFn` returns the entity keys a row belongs to — zero keys drops the
 * row (a course outside the catalog), several keys fan it out (every student of a course, every
 * teacher of a co-taught one). Keys are opaque strings; the analyzer's lenses supply courseId,
 * studentKey, teacherKey or cohort.
 */
export const expandLanes = <Row extends LaneRow>(rows: Row[], keyFn: (row: Row) => readonly string[]): Lane[] => {
  const periodsByLane = new Map<string, Set<number>>();
  for (const row of rows) {
    for (const entityKey of keyFn(row)) {
      for (const weekLane of lanesOf(row.week)) {
        const key = laneKey(entityKey, row.day, weekLane);
        const periods = periodsByLane.get(key) ?? new Set<number>();
        periods.add(row.period);
        periodsByLane.set(key, periods);
      }
    }
  }
  return [...periodsByLane].map(([key, periods]) => ({
    ...parseLaneKey(key),
    periods: [...periods].sort((a, b) => a - b),
  }));
};

/** Span, holes, streak and edges of one lane's period set. An empty set folds to all-zeros;
 *  `expandLanes` never emits such a lane, so callers see it only from a synthetic call. */
export const laneStats = (periods: number[]): LaneStats => {
  if (periods.length === 0) return EMPTY_LANE_STATS;
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last - first + 1;
  return { count: sorted.length, first, last, span, holes: span - sorted.length, maxStreak: maxStreakOf(sorted) };
};

/** The concrete week lanes a placement occupies — the `both` fan-out, single-sourced. */
export const lanesOf = (week: PlacementWeek): WeekLane[] => (week === "both" ? ["a", "b"] : [week]);

const maxStreakOf = (sorted: number[]): number =>
  sorted.reduce(
    (streaks, period, index) => {
      const running = index > 0 && period === sorted[index - 1] + 1 ? streaks.running + 1 : 1;
      return { running, longest: Math.max(streaks.longest, running) };
    },
    { running: 0, longest: 0 },
  ).longest;

// The lane key round-trips through a string so the grouping stays one flat Map (entity keys are
// UUIDs / teacher ids, never containing "|").
const laneKey = (entityKey: string, day: number, weekLane: WeekLane): string => `${entityKey}|${day}|${weekLane}`;

const parseLaneKey = (key: string): Omit<Lane, "periods"> => {
  const [entityKey, day, weekLane] = key.split("|");
  return { entityKey, day: Number(day), weekLane: weekLane as WeekLane };
};
