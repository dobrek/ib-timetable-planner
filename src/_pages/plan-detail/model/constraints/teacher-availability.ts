import { cellKey } from "../cell-key";
import type { CellConstraint, CollisionViolation } from "./types";

/**
 * Flags co-teachers unavailable at the target cell — fanning out per co-teacher: each
 * unavailable teacher in a course's set raises its own violation naming that teacher,
 * mapping storage severity to render severity (`strong → block`, `soft → warn`).
 * Board-only: it omits `test`, so it never enters grouping enumeration or the <200ms
 * drag fast path.
 *
 * Reads `ctx.strongUnavailableByTeacher` / `ctx.softUnavailableByTeacher` (teacherKey →
 * set of `cellKey`; availability is authored per individual teacher). Strong wins if a
 * teacher is somehow both at one cell (the tri-state authoring model makes a cell exactly
 * one of available/soft/strong). Uses `cellKey` from the dependency-free `cell-key` leaf
 * (importing it from `collisions` would close the constraint-registry ⇄ `collisions` cycle;
 * the leaf module sidesteps that).
 */
export const teacherAvailability: CellConstraint = {
  id: "teacher-availability",
  explain: (occupants, ctx): CollisionViolation[] => {
    const strong = ctx.strongUnavailableByTeacher;
    const soft = ctx.softUnavailableByTeacher;
    if (!strong && !soft) return [];
    const key = cellKey(ctx.cell.day, ctx.cell.period);
    // The `: CollisionViolation[]` annotation pins `severity`'s literal. An empty
    // teacherKeys set yields no violations (no null guard, the studentKeys blueprint).
    return occupants.flatMap((course): CollisionViolation[] =>
      course.teacherKeys.flatMap((teacherKey): CollisionViolation[] => {
        if (strong?.get(teacherKey)?.has(key))
          return [{ kind: "teacher-unavailable", teacherKey, courseIds: [course.id], severity: "block" }];
        if (soft?.get(teacherKey)?.has(key))
          return [{ kind: "teacher-unavailable", teacherKey, courseIds: [course.id], severity: "warn" }];
        return [];
      }),
    );
  },
};
