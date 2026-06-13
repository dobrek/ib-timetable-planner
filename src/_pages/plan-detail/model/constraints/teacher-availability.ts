import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Flags occupants whose teacher is strong-unavailable at the target cell — one `block`
 * violation per affected occupant (mapping storage `strong → block`). Board-only: it
 * omits `test`, so it never enters grouping enumeration or the <200ms drag fast path.
 *
 * Reads `ctx.strongUnavailableByTeacher` (teacherKey → set of `cellKey`). The cell key
 * is formatted inline to mirror `collisions.cellKey` (`${day}:${period}`) without importing
 * it — the constraint registry and `collisions` form an import cycle. Phase 4 adds the
 * soft → `warn` arm here.
 */
export const teacherAvailability: CellConstraint = {
  id: "teacher-availability",
  explain: (occupants, ctx): CollisionViolation[] => {
    const strong = ctx.strongUnavailableByTeacher;
    if (!strong) return [];
    const key = `${ctx.cell.day}:${ctx.cell.period}`;
    // flatMap (not filter→map) so the `teacherKey === null` check narrows the type — no
    // non-null assertion. The `: CollisionViolation[]` annotation pins `severity`'s literal.
    return occupants.flatMap((course): CollisionViolation[] => {
      const teacherKey = course.teacherKey;
      if (teacherKey === null || !(strong.get(teacherKey)?.has(key) ?? false)) return [];
      return [{ kind: "teacher-unavailable", teacherKey, courseIds: [course.id], severity: "block" }];
    });
  },
};
