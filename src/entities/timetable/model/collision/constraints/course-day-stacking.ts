import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { DayOccupancyIndex } from "../../day-occupancy-index";
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
  explain: (occupants, ctx) => {
    const index = ctx.dayOccupancy;
    if (!index) return [];
    const { day } = ctx.cell;
    const weekOf = (courseId: string): PlacementWeek => ctx.weekByCourseId?.get(courseId) ?? "both";

    const violations: CollisionViolation[] = [];
    for (const course of distinctById(occupants)) {
      const count = stackedCount(index, course.id, day, weekOf(course.id));
      if (count !== null) violations.push({ kind: "course-day-stacking", courseIds: [course.id], count });
    }
    return violations;
  },
};

/** The size of the largest ≥3 stack among the concrete weeks this cell runs, or null when no
 *  concrete week the cell participates in reaches 3 placements of the course that day. */
const stackedCount = (index: DayOccupancyIndex, courseId: string, day: number, week: PlacementWeek): number | null => {
  const entries = index.byCourseDay.get(courseId)?.get(day) ?? [];
  const stacks = concreteWeeks(week)
    .map((concrete) => entries.filter((entry) => runsWeek(entry.week, concrete)).length)
    .filter((size) => size >= 3);
  return stacks.length > 0 ? Math.max(...stacks) : null;
};

/** The concrete fortnightly weeks a placement week participates in (`both` runs in each). */
const concreteWeeks = (week: PlacementWeek): ("a" | "b")[] => (week === "both" ? ["a", "b"] : [week]);

/** A placement runs concrete week `k` iff it is that week or agnostic (`both`). */
const runsWeek = (week: PlacementWeek, concrete: "a" | "b"): boolean => week === concrete || week === "both";

/** First occurrence of each course id — a cell can hold a same-course duplicate. */
const distinctById = (occupants: GroupingCourse[]): GroupingCourse[] => {
  const seen = new Set<string>();
  return occupants.filter((course) => !seen.has(course.id) && Boolean(seen.add(course.id)));
};
