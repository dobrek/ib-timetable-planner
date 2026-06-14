import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Flags occupants whose teacher is unavailable at the target cell — one violation per
 * affected occupant, mapping storage severity to render severity (`strong → block`,
 * `soft → warn`). Board-only: it omits `test`, so it never enters grouping enumeration
 * or the <200ms drag fast path.
 *
 * Reads `ctx.strongUnavailableByTeacher` / `ctx.softUnavailableByTeacher` (teacherKey →
 * set of `cellKey`). Strong wins if a teacher is somehow both at one cell (the tri-state
 * authoring model makes a cell exactly one of available/soft/strong). The cell key is
 * formatted inline to mirror `collisions.cellKey` (`${day}:${period}`) without importing
 * it — the constraint registry and `collisions` form an import cycle.
 */
export const teacherAvailability: CellConstraint = {
  id: "teacher-availability",
  explain: (occupants, ctx): CollisionViolation[] => {
    const strong = ctx.strongUnavailableByTeacher;
    const soft = ctx.softUnavailableByTeacher;
    if (!strong && !soft) return [];
    const key = `${ctx.cell.day}:${ctx.cell.period}`;
    // flatMap (not filter→map) so the `teacherKey === null` check narrows the type — no
    // non-null assertion. The `: CollisionViolation[]` annotation pins `severity`'s literal.
    return occupants.flatMap((course): CollisionViolation[] => {
      const teacherKey = course.teacherKey;
      if (teacherKey === null) return [];
      if (strong?.get(teacherKey)?.has(key))
        return [{ kind: "teacher-unavailable", teacherKey, courseIds: [course.id], severity: "block" }];
      if (soft?.get(teacherKey)?.has(key))
        return [{ kind: "teacher-unavailable", teacherKey, courseIds: [course.id], severity: "warn" }];
      return [];
    });
  },
};
