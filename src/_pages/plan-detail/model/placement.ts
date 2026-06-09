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

export const occupiesCell = (
  placements: LocalPlacement[],
  courseId: string,
  cell: { day: number; period: number },
): boolean => placements.some((p) => p.courseId === courseId && p.day === cell.day && p.period === cell.period);
