import type { LeadingCourseOption } from "./leading-course-options";

/**
 * The pure core of the reset-on-leading-change rule: keep the companion id only when it
 * is still among the current option list, otherwise drop it to `null`. The hook calls
 * this during render (adjust-state-during-render) so a companion that no longer co-occurs
 * with the leading course can never silently filter to zero. `null` in → `null` out (a
 * cleared companion is trivially valid).
 */
export const reconcileCompanion = (companionId: string | null, options: LeadingCourseOption[]): string | null =>
  companionId !== null && options.some((option) => option.id === companionId) ? companionId : null;
