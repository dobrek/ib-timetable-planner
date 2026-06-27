import type { PlacementWeek, WeekMode } from "@/shared/config";
import type { PlannerGrouping } from "./grouping";
import type { ParkedMember } from "./parked";
import { oppositeWeekAssignment } from "./placement-transitions";

// Pure parked-member resolution shared by both boards (single + combined), so a palette
// course/grouping dropped on the shelf resolves to the SAME off-board formation in either view.
// No target cell is involved, so there is no occupancy to resolve against (unlike a board drop).

/**
 * The week a course takes when parked straight to the shelf: a bi-weekly course defaults to `a`,
 * everything else (agnostic) to `both`. Mirrors a single course's intrinsic default with no cell
 * occupancy to consider.
 */
export const defaultParkedWeek = (courseId: string, weekModeByCourseId: Map<string, WeekMode>): PlacementWeek =>
  weekModeByCourseId.get(courseId) === "biweekly" ? "a" : "both";

/**
 * Resolve a palette grouping's off-board formation. An unknown id → `[]` (no-op). An opposite-week
 * grouping alternates its members a/b via `oppositeWeekAssignment`; every other member takes its
 * intrinsic `defaultParkedWeek`.
 */
export const groupingParkedMembers = (
  groupingId: string,
  groupings: PlannerGrouping[],
  weekModeByCourseId: Map<string, WeekMode>,
): ParkedMember[] => {
  const grouping = groupings.find((candidate) => candidate.id === groupingId);
  if (!grouping) return [];
  const weekByMember = grouping.oppositeWeek ? oppositeWeekAssignment(grouping.memberIds) : null;
  return grouping.memberIds.map((courseId) => ({
    courseId,
    week: weekByMember?.get(courseId) ?? defaultParkedWeek(courseId, weekModeByCourseId),
  }));
};
