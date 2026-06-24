import type { PlacementWeek } from "@/shared/config";
import { type AvailabilityIndex, EMPTY_AVAILABILITY_INDEX } from "./availability-index";
import { cellKey } from "./cell-key";
import { type CrossCohortIndex, EMPTY_CROSS_COHORT_INDEX } from "./cross-cohort-index";
import type { CollisionViolation } from "./constraints";
import { explainCell } from "./constraints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

// Re-exported from its dependency-free leaf module so existing `from "./collisions"` importers
// (grid, droppables, slot cells, tests) keep their import site unchanged.
export { cellKey };

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
  availability: AvailabilityIndex = EMPTY_AVAILABILITY_INDEX,
  occupiedByTeacher: CrossCohortIndex = EMPTY_CROSS_COHORT_INDEX,
): Map<string, CellCollisions> => {
  const cells = bucketByCell(placements, catalogById);

  const collisions = new Map<string, CellCollisions>();
  for (const [key, { cell, occupants, weekByCourseId }] of cells) {
    // No <2 short-circuit: teacher-unavailable flags a SINGLE occupant whose teacher
    // can't teach this cell. The other constraints still need >=2 and return [] otherwise.
    const violations = explainCell(occupants, {
      cell,
      catalogById,
      strongUnavailableByTeacher: availability.strongUnavailableByTeacher,
      softUnavailableByTeacher: availability.softUnavailableByTeacher,
      weekByCourseId,
      occupiedByTeacher,
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
export type CellBucket = {
  cell: { day: number; period: number };
  occupants: GroupingCourse[];
  /** courseId → placement week for the occupants of this cell (course is unique per cell). */
  weekByCourseId: Map<string, PlacementWeek>;
};

export const bucketByCell = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
): Map<string, CellBucket> => {
  const cells = new Map<string, CellBucket>();
  for (const placement of placements) {
    const course = catalogById.get(placement.courseId);
    if (!course) continue; // not in the validation catalog — cannot judge, skip defensively
    const key = cellKey(placement.day, placement.period);
    const entry = cells.get(key);
    if (entry) {
      entry.occupants.push(course);
      entry.weekByCourseId.set(course.id, placement.week);
    } else {
      cells.set(key, {
        cell: { day: placement.day, period: placement.period },
        occupants: [course],
        weekByCourseId: new Map([[course.id, placement.week]]),
      });
    }
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
