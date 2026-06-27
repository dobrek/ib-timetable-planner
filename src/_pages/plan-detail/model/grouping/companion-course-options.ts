import { leadingCourseOptions } from "./leading-course-options";
import type { LeadingCourseOption } from "./leading-course-options";
import type { PlannerGrouping } from "./grouping";

/**
 * The companion dropdown's option list: the distinct courses that co-occur with the
 * leading course, each with the number of matched groupings it appears in, excluding
 * the leading course itself. Reuses `leadingCourseOptions`' single-pass counting over
 * the leading-filtered subset rather than reimplementing it.
 *
 * The subset is the *leading-only* filtered set (groupings containing `leadingId`), NOT
 * the leading+companion `visibleGroupings` — so picking a companion never shrinks its
 * own option list. Returns `[]` when no leading course is set (companion disabled), and
 * is returned **unsorted**; the caller applies `sortByName`, mirroring `leadingCourseOptions`.
 */
export const companionCourseOptions = (
  groupings: PlannerGrouping[],
  names: Record<string, string>,
  leadingId: string | null,
): LeadingCourseOption[] => {
  if (leadingId === null) return [];
  const subset = groupings.filter((grouping) => grouping.memberIds.includes(leadingId));
  return leadingCourseOptions(subset, names).filter((option) => option.id !== leadingId);
};
