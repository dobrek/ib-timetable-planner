import type { LocalPlacement } from "@/entities/timetable";

/** One course's pending-optional count — the model half of the popover's "Optional" review section. */
export type OptionalCourseCount = { courseId: string; count: number };

export type OptionalTally = {
  /** One entry per course with optional placements (unordered — display sort happens at the UI edge). */
  optionalByCourse: OptionalCourseCount[];
  /** The cohort's total pending optional placements — the popover headline's per-cohort term. */
  optionalCount: number;
};

/**
 * Tally a cohort's pending optional decisions in one pass over its live placements. Derived in the
 * model like the hours siblings (`useHours`), so the summary at the UI edge only resolves display
 * names and sorts — and the headline total and the per-course rows come from the same `optional`
 * array, so they cannot drift apart.
 */
export function deriveOptionalTally(placements: LocalPlacement[]): OptionalTally {
  const optional = placements.filter((placement) => placement.isOptional);
  const countByCourse = new Map<string, number>();
  for (const placement of optional) {
    countByCourse.set(placement.courseId, (countByCourse.get(placement.courseId) ?? 0) + 1);
  }
  return {
    optionalByCourse: [...countByCourse].map(([courseId, count]) => ({ courseId, count })),
    optionalCount: optional.length,
  };
}
