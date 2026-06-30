import type { Cohort } from "@/shared/config";
import type { CourseDisplay } from "./course-display";
import type { BoardAvailabilityCell } from "./cross-cohort/availability-index";
import type { SiblingOccupancyCell } from "./cross-cohort/cross-cohort-index";
import type { GroupingCourse, PlannerGrouping } from "./grouping/grouping";
import type { ParkedBundle } from "./placement/parked";
import type { PlannerPlacement } from "./placement/placement";

/**
 * Drag payload carried on the draggable's `data`. Identity is opaque ids — never names.
 *
 * Every relocating drag carries its source `cohort` so the shared drop router can guard a
 * cross-cohort move; it is always present (the single board tags its one cohort, the combined board
 * each column's). `CourseDrag`/`GroupDrag` stay cohort-free: they originate from the (cohort-scoped)
 * palette and adopt the target cell's cohort on drop (or park under the palette's active cohort).
 */
export type CourseDrag = { kind: "course"; courseId: string };
export type PlacementDrag = { kind: "placement"; placementId: string; courseId: string; cohort: Cohort };
export type GroupDrag = { kind: "grouping"; groupingId: string };
/** Whole-slot drag: moves every placement at the source cell as one unit. */
export type BundleDrag = { kind: "bundle"; day: number; period: number; cohort: Cohort };
/** A parked (shelved) card dragged back toward a slot (S-07 place-back). */
export type ParkedDrag = { kind: "parked"; shelfBundleId: string; cohort: Cohort };
export type DragData = CourseDrag | PlacementDrag | GroupDrag | BundleDrag | ParkedDrag;

/** A bare slot coordinate — the cohort-free `(day, period)` the persist/geometry/hint layer speaks.
 *  The cell *droppable* tags it with a cohort (`CellDropData`); the action layer reads only the coords. */
export type CellData = { day: number; period: number };
/** Drop payload carried on a cell droppable's `data`. Every cell is cohort-tagged (one board, two
 *  columns in combined; the single board tags its one cohort) so the router resolves by cohort. */
export type CellDropData = CellData & { cohort: Cohort };
/** Drop payload carried on the island-wide shelf droppable's `data` (S-07 lift). */
export type ShelfData = { kind: "shelf" };
/** The drop-target union the board's drop handler discriminates: a cohort-tagged cell or the shelf. */
export type DropTargetData = CellDropData | ShelfData;

/** Plan-scoped board data shared by both cohort columns — assembled once in the loader. */
export type SharedBoardProps = {
  planId: string;
  days: number;
  periods: number;
  /** Plan-scoped teacher availability (all teachers, cohort-independent), raw cells the
   *  island indexes into Maps. Strong drives the board flag now; soft is consumed in Phase 4. */
  availability: BoardAvailabilityCell[];
  /** teacherKey → display name (`full_name ?? code`), resolved from the union of both catalogs. */
  teacherNames: Record<string, string>;
};

/** Per-cohort props assembled server-side in `plans/[id]/index.astro` and handed to the island. */
export type PlannerBoardProps = {
  cohort: Cohort;
  groupings: PlannerGrouping[];
  /** Per-cohort palette staleness (live catalog hash ≠ stored grouping hash); drives the palette notice only. */
  stale: boolean;
  /** courseId → display data (name + optional color), resolved at the edge (never baked into drag payloads). */
  courseDisplay: Record<string, CourseDisplay>;
  /** studentKey → full name for this cohort's catalog enrollments. */
  studentNames: Record<string, string>;
  placements: PlannerPlacement[];
  /** Validation catalog: `GroupingCourse[]` keyed by course id. */
  catalog: GroupingCourse[];
  /** Sibling-cohort teacher occupancy (co-teacher-expanded, week-rich), raw cells the island
   *  indexes into the cross-cohort Map. Drives the board-only `cross-cohort-teacher` rule. */
  crossCohortOccupancy: SiblingOccupancyCell[];
  /** Parked (shelved) bundles for this cohort — the server-durable off-board set (S-07). */
  parkedBundles: ParkedBundle[];
};
