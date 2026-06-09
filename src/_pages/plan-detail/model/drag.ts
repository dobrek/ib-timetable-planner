import type { GroupingCourse, PlannerGrouping } from "./grouping";
import type { PlannerPlacement } from "./placement";

/** Drag payload carried on the draggable's `data`. Identity is opaque ids — never names. */
export type CourseDrag = { kind: "course"; courseId: string };
export type PlacementDrag = { kind: "placement"; placementId: string; courseId: string };
export type DragData = CourseDrag | PlacementDrag;

/** Drop payload carried on a cell droppable's `data`. */
export type CellData = { day: number; period: number };

/** Props assembled server-side in `plans/[id].astro` and handed to the island. */
export type PlannerBoardProps = {
  planId: string;
  variantId: string;
  cohortId: string;
  days: number;
  periods: number;
  groupings: PlannerGrouping[];
  /** courseId → display name, resolved at the edge (never baked into drag payloads). */
  names: Record<string, string>;
  placements: PlannerPlacement[];
  /** Validation catalog: `GroupingCourse[]` keyed by course id. */
  catalog: GroupingCourse[];
};
