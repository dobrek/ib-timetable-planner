import type { LeadingCourseOption } from "./leading-course-options";

/**
 * Residual validity guard: drop a companion that a data change left invalid — keep the id only
 * when it is still among the current option list, otherwise reset it to `null`. The hook calls
 * this during render (adjust-state-during-render) so a companion that no longer co-occurs with
 * the leading course can never silently filter to zero. The reset-on-leading-change rule itself
 * lives in the hook's `changeLeading` handler, not here. `null` in → `null` out (a cleared
 * companion is trivially valid).
 */
export const reconcileCompanion = (companionId: string | null, options: LeadingCourseOption[]): string | null =>
  companionId !== null && options.some((option) => option.id === companionId) ? companionId : null;
