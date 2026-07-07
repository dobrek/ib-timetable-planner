import type { Cohort, SubjectColor } from "@/shared/config";
import { type CourseDisplay, type CourseHours, resolveCourseDisplay } from "@/entities/timetable";

/** One popover row: course identity resolved to display (name + subject color) plus its hours. */
export type CoursesLeftRow = {
  courseId: string;
  name: string;
  color: SubjectColor | null;
  placed: number;
  required: number;
};

/** One "Optional" section row: a course with optional placements and how many it has. */
export type OptionalCourseRow = {
  courseId: string;
  name: string;
  color: SubjectColor | null;
  count: number;
};

/** A cohort's sections: courses missing board hours, courses placed past requirement, and courses with pending optional placements. */
export type CoursesLeftCohort = {
  cohort: Cohort;
  missing: CoursesLeftRow[];
  over: CoursesLeftRow[];
  optional: OptionalCourseRow[];
};

/** The whole breakdown: the headline totals plus the per-cohort sections the popover renders. */
export type CoursesLeftSummary = {
  hoursLeft: number;
  hoursOver: number;
  /** Total optional placements across cohorts — the "Optional" section renders only when > 0. */
  optionalCount: number;
  cohorts: CoursesLeftCohort[];
};

/** The slice of a placement the optional derivation reads — `LocalPlacement` satisfies it. */
type PlacementFlag = { courseId: string; isOptional: boolean };

/** One active cohort's already-derived hours arrays (identity + hours), awaiting display + sort. */
type CohortInput = {
  cohort: Cohort;
  courseDisplay: Record<string, CourseDisplay>;
  unplaced: CourseHours[];
  overplaced: CourseHours[];
  hoursLeft: number;
  hoursOver: number;
  /** The cohort's live placements — the "Optional" review section derives from their flags. */
  placements: PlacementFlag[];
};

/**
 * Turn each active cohort's derived hours arrays into the display-resolved, sorted structure the
 * popover renders, plus the combined headline totals. Sorting lives here (the UI edge), not in the
 * model, because the alphabetical tie-break needs the resolved course name. Rows sort largest-gap
 * first: `missing` by hours-left (required − placed) desc, `over` by hours-over (placed − required)
 * desc, each tie broken by name asc. The two totals sum across cohorts and stay independent — the
 * non-netting invariant is inherited from `summarizeHours` upstream and never recombined here.
 * The additive `optional` section (count desc, name asc) is a review checklist of pending
 * per-member decisions; it never feeds the hour totals (an optional member still counts as placed).
 */
export const buildCoursesLeftSummary = (inputs: CohortInput[]): CoursesLeftSummary => ({
  hoursLeft: inputs.reduce((sum, input) => sum + input.hoursLeft, 0),
  hoursOver: inputs.reduce((sum, input) => sum + input.hoursOver, 0),
  optionalCount: inputs.reduce((sum, input) => sum + input.placements.filter(isOptionalPlacement).length, 0),
  cohorts: inputs.map((input) => ({
    cohort: input.cohort,
    missing: toRows(input.unplaced, input.courseDisplay).sort(byGapThenName(hoursLeftOf)),
    over: toRows(input.overplaced, input.courseDisplay).sort(byGapThenName(hoursOverOf)),
    optional: toOptionalRows(input.placements, input.courseDisplay),
  })),
});

// Resolve each course id to its display (name + color) at the edge; a fresh array, so the caller's
// in-place `.sort()` mutates nothing external (the model arrays stay untouched).
const toRows = (courses: CourseHours[], courseDisplay: Record<string, CourseDisplay>): CoursesLeftRow[] =>
  courses.map(({ courseId, placed, required }) => {
    const { name, color } = resolveCourseDisplay(courseDisplay, courseId);
    return { courseId, name, color, placed, required };
  });

const isOptionalPlacement = (placement: { isOptional: boolean }): boolean => placement.isOptional;

// One row per course having optional placements: filter → unique course ids → display + count,
// sorted most-pending first (count desc), ties broken alphabetically by resolved name.
const toOptionalRows = (
  placements: PlacementFlag[],
  courseDisplay: Record<string, CourseDisplay>,
): OptionalCourseRow[] => {
  const optional = placements.filter(isOptionalPlacement);
  return [...new Set(optional.map((placement) => placement.courseId))]
    .map((courseId) => {
      const { name, color } = resolveCourseDisplay(courseDisplay, courseId);
      return { courseId, name, color, count: optional.filter((placement) => placement.courseId === courseId).length };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const hoursLeftOf = (row: CoursesLeftRow): number => row.required - row.placed;
const hoursOverOf = (row: CoursesLeftRow): number => row.placed - row.required;

// Largest gap first, ties broken alphabetically by the resolved (display) name.
const byGapThenName =
  (gapOf: (row: CoursesLeftRow) => number) =>
  (a: CoursesLeftRow, b: CoursesLeftRow): number =>
    gapOf(b) - gapOf(a) || a.name.localeCompare(b.name);
