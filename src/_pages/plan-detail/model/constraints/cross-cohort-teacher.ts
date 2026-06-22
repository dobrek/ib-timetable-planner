import { weeksDisjoint } from "../week";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Flags a teacher double-booked across cohorts: for each occupant, for each of its co-teachers,
 * raise a blocking violation iff that teacher is occupied in the *other* cohort at this cell in a
 * week that is NOT disjoint from the occupant's own week (an agnostic `both` on either side
 * overlaps every week; opposite single weeks A/B do not collide). Symmetric by construction — the
 * rule has no notion of a "primary" cohort, it only reads `ctx.occupiedByTeacher`, so the same
 * operation validates whichever cohort is active.
 *
 * Board-only: it omits `test`, so it never enters grouping enumeration or the <200ms drag fast
 * path. Reuses `weeksDisjoint` (kept a named export in `week.ts` for exactly this). The cell key is
 * formatted inline to mirror `collisions.cellKey` (`${day}:${period}`) without importing it — the
 * constraint registry and `collisions` form an import cycle (see `teacher-availability.ts`).
 */
export const crossCohortTeacher: CellConstraint = {
  id: "cross-cohort-teacher",
  explain: (occupants, ctx): CollisionViolation[] => {
    const occupied = ctx.occupiedByTeacher;
    if (!occupied) return []; // single-cohort regression path
    const key = `${ctx.cell.day}:${ctx.cell.period}`;
    return occupants.flatMap((course): CollisionViolation[] => {
      const occupantWeek = ctx.weekByCourseId?.get(course.id) ?? "both";
      return course.teacherKeys.flatMap((teacherKey): CollisionViolation[] => {
        const siblingWeeks = occupied.get(teacherKey)?.get(key);
        if (!siblingWeeks) return [];
        for (const siblingWeek of siblingWeeks) {
          if (!weeksDisjoint(occupantWeek, siblingWeek))
            return [{ kind: "cross-cohort-teacher", teacherKey, courseIds: [course.id] }];
        }
        return [];
      });
    });
  },
};
