import type { Cohort } from "@/shared/config";
import type { BoardAvailabilityCell } from "./availability-index";
import type { SiblingOccupancyCell } from "./cross-cohort-index";
import type { GroupingCourse, PlannerGrouping } from "./grouping";
import type { PlannerPlacement } from "./placement";
import type { SlotOverride } from "./slot-bundle";

/** Drag payload carried on the draggable's `data`. Identity is opaque ids — never names. */
export type CourseDrag = { kind: "course"; courseId: string };
export type PlacementDrag = { kind: "placement"; placementId: string; courseId: string };
export type GroupDrag = { kind: "grouping"; groupingId: string };
/** Whole-slot drag: moves every placement at the source cell as one unit. */
export type BundleDrag = { kind: "bundle"; day: number; period: number };
export type DragData = CourseDrag | PlacementDrag | GroupDrag | BundleDrag;

/** Drop payload carried on a cell droppable's `data`. */
export type CellData = { day: number; period: number };

/** Props assembled server-side in `plans/[id]/index.astro` and handed to the island. */
export type PlannerBoardProps = {
  planId: string;
  cohort: Cohort;
  days: number;
  periods: number;
  groupings: PlannerGrouping[];
  /** courseId → display name, resolved at the edge (never baked into drag payloads). */
  names: Record<string, string>;
  /** teacherKey → display name (`full_name ?? code`), resolved at the edge — never baked into drag payloads or violations. */
  teacherNames: Record<string, string>;
  /** studentKey → full name, resolved at the edge — never baked into drag payloads or violations. */
  studentNames: Record<string, string>;
  placements: PlannerPlacement[];
  /** Persisted unbundled overrides (cells the planner explicitly ungrouped). */
  overrides: SlotOverride[];
  /** Validation catalog: `GroupingCourse[]` keyed by course id. */
  catalog: GroupingCourse[];
  /** Plan-scoped teacher availability (all teachers, cohort-independent), raw cells the
   *  island indexes into Maps. Strong drives the board flag now; soft is consumed in Phase 4. */
  availability: BoardAvailabilityCell[];
  /** Sibling-cohort teacher occupancy (co-teacher-expanded, week-rich), raw cells the island
   *  indexes into the cross-cohort Map. Drives the board-only `cross-cohort-teacher` rule. */
  crossCohortOccupancy: SiblingOccupancyCell[];
};
