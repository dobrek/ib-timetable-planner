import type { PlacementWeek } from "@/shared/config";
import { lanesOf } from "../../analysis/lanes";
import { weeksDisjoint } from "../../week";
import type { DayOccupancyIndex } from "../../day-occupancy-index";
import { distinctById } from "./distinct-by-id";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Blocking rule for `finishes_early` courses: a flagged course must sit at the first or last
 * period an enrolled student occupies that day, so when it stops running mid-year its students
 * start later / finish earlier instead of inheriting a mid-day hole.
 *
 * Per placement, per student, per week LANE: for a flagged course `F` at this cell on week `w`, each
 * student `s` in `F`, and each concrete fortnightly week `l` that `w` runs, let `O` be the periods
 * `s` occupies that day via courses *other than* `F` that also run `l`. It is a violation for `s`
 * unless `O` is empty, or the cell's period `≤ min(O)`, or `≥ max(O)` — i.e. only strictly-interior
 * placements offend. Comparing against *other* courses' periods (not "first/last of all") lets a
 * legal edge double (F at 1–2 before others at 3–5) pass without self-violating; comparing per lane
 * (not against the union of both weeks) keeps the rule to days the student actually lives — see
 * `isInterior`.
 *
 * Board-only (no `test`): invisible to grouping enumeration, and returns `[]` until the context
 * carries both the flag set and the day-occupancy index (the regression path).
 */
export const earlyFinishEdge: CellConstraint = {
  id: "early-finish-edge",
  explain: (occupants, ctx): CollisionViolation[] => {
    const flagged = ctx.finishesEarlyByCourseId;
    const index = ctx.dayOccupancy;
    if (!flagged || !index) return [];
    const { day, period } = ctx.cell;
    const weekOf = (courseId: string): PlacementWeek => ctx.weekByCourseId?.get(courseId) ?? "both";

    return distinctById(occupants)
      .filter((course) => flagged.has(course.id))
      .flatMap((course): CollisionViolation[] => {
        const week = weekOf(course.id);
        const studentKeys = course.studentKeys.filter((studentKey) =>
          isInterior(index, studentKey, day, period, week, course.id),
        );
        return studentKeys.length > 0 ? [{ kind: "early-finish-edge", courseIds: [course.id], studentKeys }] : [];
      });
  },
};

/**
 * True when `period` sits strictly between the earliest and latest OTHER period the student occupies
 * this day, **in some concrete week the flagged placement runs**. Empty `O` ⇒ not interior.
 *
 * Per LANE, not per union: a `both`-week flagged course whose only week-A neighbour is below it and
 * whose only week-B neighbour is above it is at a day edge in *each real week the student lives*
 * (last lesson in week A, first in week B) — reading the two weeks as one set would invent a hole
 * that never occurs. It would also make the oracle stricter than the engine's own `fitsAt` guard
 * (which is lane-wise, `board.ts`), so the search would happily construct such a board and the final
 * verdict would throw the whole 20-second solve away — the fitsAt-looser-than-verify trap, in the
 * one direction that produces no in-loop signal.
 */
const isInterior = (
  index: DayOccupancyIndex,
  studentKey: string,
  day: number,
  period: number,
  week: PlacementWeek,
  flaggedCourseId: string,
): boolean => {
  const entries = (index.byStudentDay.get(studentKey)?.get(day) ?? []).filter(
    (entry) => entry.courseId !== flaggedCourseId,
  );
  return lanesOf(week).some((lane) => {
    const others = entries.filter((entry) => !weeksDisjoint(entry.week, lane)).map((entry) => entry.period);
    return others.length > 0 && period > Math.min(...others) && period < Math.max(...others);
  });
};
