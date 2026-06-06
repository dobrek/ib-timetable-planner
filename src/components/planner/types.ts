import type { GroupingCourse } from "@/lib/grouping/types";

/** A palette hint box: a deduped member-set read from `course_groupings`. */
export type PlannerGrouping = {
  id: string;
  memberIds: string[];
  coverageCount: number;
  score: number;
};

/** One placed course-hour. `id` may be a temporary client id until the POST reconciles. */
export type PlannerPlacement = {
  id: string;
  courseId: string;
  day: number;
  period: number;
};

/**
 * A placement in island-local state. `pending` is true while an optimistic row's
 * server id has not yet reconciled — move/remove are gated until it clears so a
 * DELETE never targets a temporary id.
 */
export type LocalPlacement = PlannerPlacement & { pending?: boolean };

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
