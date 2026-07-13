import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { AnalyzerCourse, AnalyzerRow } from "../types";

/**
 * Analyzer-side fixture builders: the entity's shared `course` / `biweekly` / `coTaught` builders
 * lifted into the analyzer's own projection (subject identity added), plus a row builder.
 *
 * `hours` is NOT defaulted away here. The shared builders standardize `hours: 4` because it is inert
 * for the collision rules they were written for — but completeness and daily-load metrics read it
 * directly, so analyzer fixtures state it explicitly wherever it matters.
 */

/** Lift a `GroupingCourse` (from the shared builders) into the analyzer projection. */
export const analyzed = (
  base: GroupingCourse,
  subject: { name: string; level?: string; groupIndex?: number; hours?: number },
): AnalyzerCourse => ({
  ...base,
  hours: subject.hours ?? base.hours,
  name: subject.name,
  level: subject.level ?? "none",
  groupIndex: subject.groupIndex ?? 0,
});

/** One placed course-hour of a cohort. `week` defaults `both` (agnostic). */
export const row = (
  cohort: Cohort,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
): AnalyzerRow => ({ cohort, courseId, day, period, week });

/** `hours` consecutive rows of one course on one day, starting at `period` — a double/triple block. */
export const block = (
  cohort: Cohort,
  courseId: string,
  day: number,
  period: number,
  hours: number,
  week: PlacementWeek = "both",
): AnalyzerRow[] => Array.from({ length: hours }, (_, index) => row(cohort, courseId, day, period + index, week));
