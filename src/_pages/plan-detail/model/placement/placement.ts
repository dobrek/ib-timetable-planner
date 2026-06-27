import type { PlacementWeek } from "@/shared/config";

/** One placed course-hour. `id` may be a temporary client id until the POST reconciles. */
export type PlannerPlacement = {
  id: string;
  courseId: string;
  day: number;
  period: number;
  /** Which fortnightly week this placement runs on. Agnostic courses are always `both`. */
  week: PlacementWeek;
  /**
   * The bundle this placement belongs to. The server always supplies it (`bundle_id` is
   * `NOT NULL`); it is `undefined` only on an unsettled optimistic row, before `settleMany`
   * swaps in the server row. Carried for forward use (S-07 park / S-08 undo) — no S-05 code
   * reads it: bundled-ness for render is occupant-count-derived, and move/remove identify the
   * bundle by cell + member set, not by this handle.
   */
  bundleId?: string;
};

/**
 * A placement in island-local state. `pending` is true while an optimistic row's
 * server id has not yet reconciled — move/remove are gated until it clears so a
 * DELETE never targets a temporary id.
 */
export type LocalPlacement = PlannerPlacement & { pending?: boolean };

export const occupiesCell = (
  placements: LocalPlacement[],
  courseId: string,
  cell: { day: number; period: number },
): boolean => placements.some((p) => p.courseId === courseId && p.day === cell.day && p.period === cell.period);
