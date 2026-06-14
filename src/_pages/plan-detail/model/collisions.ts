import type { AvailabilityIndex } from "./availability-index";
import type { CollisionViolation } from "./constraints";
import { explainCell } from "./constraints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

/** Canonical `(day, period)` cell identity, shared by the grid, droppables, and the collision map. */
export const cellKey = (day: number, period: number): string => `${day}:${period}`;

export type CellCollisions = {
  /** Course ids in BLOCKING violations (collisions + strong-NO) — drives the destructive
   *  ring and counts the cell/plan invalid. */
  blockingIds: Set<string>;
  /** Course ids in WARN violations only (soft-NO) — drives the amber, non-blocking ring.
   *  Never counts as invalid; a course also in a blocking violation lands in `blockingIds`. */
  warningIds: Set<string>;
  /** Course ids flagged by a teacher-unavailable violation (either severity) — drives the
   *  distinguished "unavailable" badge (vs the generic collision badge). */
  unavailableIds: Set<string>;
  /** Structured explanations for the cell, in registry order — drives the detail Dialog. */
  violations: CollisionViolation[];
};

// Local empty default so 2-arg callers (and the no-availability case) need no index. Kept
// here rather than imported from `availability-index` to avoid a runtime import cycle
// (availability-index → collisions for `cellKey`).
const NO_AVAILABILITY: AvailabilityIndex = {
  strongUnavailableByTeacher: new Map(),
  softUnavailableByTeacher: new Map(),
};

/**
 * Per-cell collision derivation from current placement state and the validation
 * catalog. For each multi-occupancy cell, the constraint registry enumerates every
 * violation among the occupants; `conflictingIds` is the union of course ids across
 * those violations (same semantics the grid flagged before violations existed).
 *
 * Pure and O(occupants²) per cell over tiny N — recompute on every add/move/remove
 * so a flag auto-clears when a participant leaves.
 */
export const deriveCellViolations = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex = NO_AVAILABILITY,
): Map<string, CellCollisions> => {
  const cells = bucketByCell(placements, catalogById);

  const collisions = new Map<string, CellCollisions>();
  for (const [key, { cell, occupants }] of cells) {
    // No <2 short-circuit: teacher-unavailable flags a SINGLE occupant whose teacher
    // can't teach this cell. The other constraints still need >=2 and return [] otherwise.
    const violations = explainCell(occupants, {
      cell,
      catalogById,
      strongUnavailableByTeacher: availability.strongUnavailableByTeacher,
      softUnavailableByTeacher: availability.softUnavailableByTeacher,
    });
    if (violations.length > 0) {
      collisions.set(key, {
        blockingIds: collectIdsBySeverity(violations, "block"),
        warningIds: collectIdsBySeverity(violations, "warn"),
        unavailableIds: collectUnavailableIds(violations),
        violations,
      });
    }
  }
  return collisions;
};

/**
 * Group placements into their `(day, period)` cells, projecting each to its
 * validation-catalog course (placements whose course is absent are skipped).
 * Shared by `deriveCellViolations` and the drag-hint derivation (`drop-hints.ts`)
 * so both read occupants the same way.
 */
export const bucketByCell = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, { cell: { day: number; period: number }; occupants: GroupingCourse[] }> => {
  const cells = new Map<string, { cell: { day: number; period: number }; occupants: GroupingCourse[] }>();
  for (const placement of placements) {
    const course = catalogById.get(placement.courseId);
    if (!course) continue; // not in the validation catalog — cannot judge, skip defensively
    const key = cellKey(placement.day, placement.period);
    const entry = cells.get(key);
    if (entry) entry.occupants.push(course);
    else cells.set(key, { cell: { day: placement.day, period: placement.period }, occupants: [course] });
  }
  return cells;
};

/** Course ids across the violations of a given render severity. Every kind except
 *  teacher-unavailable is `block`; teacher-unavailable carries its own severity. */
const collectIdsBySeverity = (violations: CollisionViolation[], severity: "block" | "warn"): Set<string> => {
  const ids = new Set<string>();
  for (const violation of violations) {
    if (violationSeverity(violation) !== severity) continue;
    if (violation.kind === "duplicate-course") ids.add(violation.courseId);
    else for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};

const violationSeverity = (violation: CollisionViolation): "block" | "warn" =>
  violation.kind === "teacher-unavailable" ? violation.severity : "block";

const collectUnavailableIds = (violations: CollisionViolation[]): Set<string> => {
  const ids = new Set<string>();
  for (const violation of violations) {
    if (violation.kind === "teacher-unavailable") for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};
