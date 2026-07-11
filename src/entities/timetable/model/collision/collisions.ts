import type { PlacementWeek } from "@/shared/config";
import { type AvailabilityIndex, EMPTY_AVAILABILITY_INDEX } from "../availability-index";
import { cellKey } from "./cell-key";
import { type CrossCohortIndex, EMPTY_CROSS_COHORT_INDEX } from "../cross-cohort-index";
import { buildDayOccupancyIndex } from "../day-occupancy-index";
import type { CollisionViolation } from "./constraints";
import { explainCell } from "./constraints";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { PlannerPlacement } from "../placement";

/** Empty flag set for the finishes-early edge rule — the single-cohort / pre-delivery default. */
const EMPTY_FINISHES_EARLY = new Set<string>();

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
  finishesEarlyByCourseId: Set<string> = EMPTY_FINISHES_EARLY,
): Map<string, CellCollisions> => {
  const cells = bucketByCell(placements, catalogById);
  // Built once per derivation from the same inputs; both call sites (board + teacher
  // perspective) inherit the day-scoped rules for free. The stacking rule is always live;
  // the edge rule stays dormant until `finishesEarlyByCourseId` is non-empty (Phase 3 delivery).
  const dayOccupancy = buildDayOccupancyIndex(placements, catalogById);

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
      finishesEarlyByCourseId,
      dayOccupancy,
    });
    if (violations.length > 0) {
      collisions.set(key, buildCellCollisions(violations));
    }
  }
  return collisions;
};

/**
 * Project a violation list into the `CellCollisions` render sets. The single home of the
 * severity semantics (every kind blocks except teacher-unavailable, which carries its own
 * severity) — shared by the full-board derivation above and the teacher-perspective
 * narrowing, so a filtered violation list rebuilds identical sets.
 */
export const buildCellCollisions = (violations: CollisionViolation[]): CellCollisions => ({
  blockingIds: collectIdsBySeverity(violations, "block"),
  warningIds: collectIdsBySeverity(violations, "warn"),
  unavailableIds: collectUnavailableIds(violations),
  violations,
});

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

const violationSeverity = (violation: CollisionViolation): "block" | "warn" => {
  if (violation.kind === "teacher-unavailable") return violation.severity;
  // The daily-spread cap is advisory; the early-finish edge rule blocks like a collision.
  if (violation.kind === "course-day-stacking") return "warn";
  return "block";
};

const collectUnavailableIds = (violations: CollisionViolation[]): Set<string> => {
  const ids = new Set<string>();
  for (const violation of violations) {
    if (violation.kind === "teacher-unavailable") for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};
