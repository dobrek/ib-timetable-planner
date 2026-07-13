import { deriveGenerationDeficits } from "../generation/deficits";
import type { PlannerPlacement } from "../placement";
import type { AnalyzerCourse, AnalyzerRow, CompletenessFeatures } from "./types";

/**
 * Unplaced hours per cohort — the tier-1 number that must never be missing from a report. A slot
 * count flatters an incomplete board (fewer hours ⇒ fewer slots), which is exactly how the engine's
 * 5 unplaced hours hid behind a "better" slot count in the v0 comparison. Every renderer prints
 * this beside the slots.
 *
 * A thin wrapper over `deriveGenerationDeficits`, so "unplaced" means precisely what it means to
 * the generator (net of parked coverage, clamped per course, never netted across courses).
 */
export const deriveCompleteness = (
  rows: AnalyzerRow[],
  courses: AnalyzerCourse[],
  parkedCourseIds: string[],
): CompletenessFeatures => {
  const unplaced = deriveGenerationDeficits(asPlacements(rows), courses, parkedCourseIds);
  return { unplacedHours: unplaced.reduce((sum, deficit) => sum + deficit.missing, 0), unplaced };
};

/** Analyzer rows carry no ids (they may come from an engine result, not the DB), and the deficit
 *  derivation reads only `courseId` — so synthetic ids are safe here, as in `verify.ts`. */
const asPlacements = (rows: AnalyzerRow[]): PlannerPlacement[] =>
  rows.map((row, index) => ({
    id: `analyzed:${row.cohort}:${index}`,
    courseId: row.courseId,
    day: row.day,
    period: row.period,
    week: row.week,
    isOptional: false,
  }));
