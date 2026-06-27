import type { Cohort } from "@/shared/config";
import type { BoardAvailabilityCell } from "./cross-cohort/availability-index";
import type { SiblingOccupancyCell } from "./cross-cohort/cross-cohort-index";
import type { GroupingCourse, PlannerGrouping } from "./grouping/grouping";
import type { ParkedBundle } from "./placement/parked";
import type { PlannerPlacement } from "./placement/placement";

/**
 * Drag payload carried on the draggable's `data`. Identity is opaque ids — never names.
 *
 * The optional `cohort` is the combined-view opt-in (S-06): a per-column wrapper stamps it so a
 * shared drop handler can route and guard relocating drags by cohort. Single-cohort drags omit it
 * — the field is absent and behaviour is unchanged. `CourseDrag`/`GroupDrag` stay cohort-free: they
 * originate from the (cohort-scoped) palette and adopt the target cell's cohort on drop.
 */
export type CourseDrag = { kind: "course"; courseId: string };
export type PlacementDrag = { kind: "placement"; placementId: string; courseId: string; cohort?: Cohort };
export type GroupDrag = { kind: "grouping"; groupingId: string };
/** Whole-slot drag: moves every placement at the source cell as one unit. */
export type BundleDrag = { kind: "bundle"; day: number; period: number; cohort?: Cohort };
/** A parked (shelved) card dragged back toward a slot (S-07 place-back). */
export type ParkedDrag = { kind: "parked"; shelfBundleId: string; cohort?: Cohort };
export type DragData = CourseDrag | PlacementDrag | GroupDrag | BundleDrag | ParkedDrag;

/** Drop payload carried on a cell droppable's `data`. `cohort` present only in the combined view. */
export type CellData = { day: number; period: number; cohort?: Cohort };
/** Drop payload carried on the island-wide shelf droppable's `data` (S-07 lift). */
export type ShelfData = { kind: "shelf" };
/** The drop-target union the board's drop handler discriminates: a cell or the shelf. */
export type DropTargetData = CellData | ShelfData;

/** Props assembled server-side in `plans/[id]/index.astro` and handed to the island. */
export type PlannerBoardProps = {
  planId: string;
  cohort: Cohort;
  days: number;
  periods: number;
  groupings: PlannerGrouping[];
  /** Per-cohort palette staleness (live catalog hash ≠ stored grouping hash); drives the palette notice only. */
  stale: boolean;
  /** courseId → display name, resolved at the edge (never baked into drag payloads). */
  names: Record<string, string>;
  /** teacherKey → display name (`full_name ?? code`), resolved at the edge — never baked into drag payloads or violations. */
  teacherNames: Record<string, string>;
  /** studentKey → full name, resolved at the edge — never baked into drag payloads or violations. */
  studentNames: Record<string, string>;
  placements: PlannerPlacement[];
  /** Validation catalog: `GroupingCourse[]` keyed by course id. */
  catalog: GroupingCourse[];
  /** Plan-scoped teacher availability (all teachers, cohort-independent), raw cells the
   *  island indexes into Maps. Strong drives the board flag now; soft is consumed in Phase 4. */
  availability: BoardAvailabilityCell[];
  /** Sibling-cohort teacher occupancy (co-teacher-expanded, week-rich), raw cells the island
   *  indexes into the cross-cohort Map. Drives the board-only `cross-cohort-teacher` rule. */
  crossCohortOccupancy: SiblingOccupancyCell[];
  /** Parked (shelved) bundles for this cohort — the server-durable off-board set (S-07). */
  parkedBundles: ParkedBundle[];
};
