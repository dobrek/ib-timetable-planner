import { deriveGenerationDeficits } from "../generation/deficits";
import { deriveHours, deriveOverplaced, summarizeHours } from "../hours";
import type { PlannerPlacement } from "../placement";
import type { AnalyzerCourse, AnalyzerRow, CompletenessFeatures } from "./types";

/**
 * The hour accounting that must never be missing from a report. A slot count flatters an incomplete
 * board (fewer hours ⇒ fewer slots), which is exactly how the engine's abandoned hours once hid
 * behind a "better" slot count in the v0 comparison.
 *
 * `unplaced` is a thin wrapper over `deriveGenerationDeficits`, so it means precisely what it means
 * to the generator (net of parked coverage, clamped per course, never netted across courses).
 * `overplaced` is its twin and is reported **beside** it, never subtracted from it — the gold plan's
 * dp1 Chemistry sits at +4 over-placed (six expert hours on a course the catalog says needs two,
 * because its overlap base carries no direct enrolments and drops out of the projection), and that
 * surplus is a finding, not an accounting error to cancel against someone else's shortfall.
 *
 * `uncataloguedRows` closes the last hole: a placed row whose course never made it into the
 * projection is invisible to every join in the analyzer, so it is counted here rather than lost.
 */
export const deriveCompleteness = (
  rows: AnalyzerRow[],
  courses: AnalyzerCourse[],
  parkedCourseIds: string[],
): CompletenessFeatures => {
  const placements = asPlacements(rows);
  const unplaced = deriveGenerationDeficits(placements, courses, parkedCourseIds);
  const overplaced = deriveOverplaced(deriveHours(placements, courses));
  const catalogued = new Set(courses.map((course) => course.id));

  return {
    unplacedHours: unplaced.reduce((sum, deficit) => sum + deficit.missing, 0),
    unplaced,
    overplacedHours: summarizeHours([], overplaced).hoursOver,
    overplaced,
    uncataloguedRows: rows.filter((row) => !catalogued.has(row.courseId)).length,
  };
};

/** Analyzer rows carry no ids (they may come from an engine result, not the DB), and the hour
 *  derivations read only `courseId` — so synthetic ids are safe here, as in `verify.ts`. */
const asPlacements = (rows: AnalyzerRow[]): PlannerPlacement[] =>
  rows.map((row, index) => ({
    id: `analyzed:${row.cohort}:${index}`,
    courseId: row.courseId,
    day: row.day,
    period: row.period,
    week: row.week,
    isOptional: false,
  }));
