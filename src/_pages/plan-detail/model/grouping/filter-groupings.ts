import type { PlannerGrouping } from "./grouping";

/**
 * The palette's two-predicate membership filter: keep groupings whose member set
 * contains the leading course AND the companion course. A `null` id switches that
 * predicate off, so both `null` returns the input groupings in their original order.
 * Pure — never mutates the input array.
 */
export const filterGroupings = (
  groupings: PlannerGrouping[],
  leadingId: string | null,
  companionId: string | null,
): PlannerGrouping[] =>
  groupings.filter(
    (grouping) =>
      (leadingId === null || grouping.memberIds.includes(leadingId)) &&
      (companionId === null || grouping.memberIds.includes(companionId)),
  );
