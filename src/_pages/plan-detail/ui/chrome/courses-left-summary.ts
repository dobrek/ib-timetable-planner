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

/** A cohort's two sections: courses still missing board hours, and courses placed past requirement. */
export type CoursesLeftCohort = { cohort: Cohort; missing: CoursesLeftRow[]; over: CoursesLeftRow[] };

/** The whole breakdown: the two headline totals plus the per-cohort sections the popover renders. */
export type CoursesLeftSummary = { hoursLeft: number; hoursOver: number; cohorts: CoursesLeftCohort[] };

/** One active cohort's already-derived hours arrays (identity + hours), awaiting display + sort. */
type CohortInput = {
  cohort: Cohort;
  courseDisplay: Record<string, CourseDisplay>;
  unplaced: CourseHours[];
  overplaced: CourseHours[];
  hoursLeft: number;
  hoursOver: number;
};

/**
 * Turn each active cohort's derived hours arrays into the display-resolved, sorted structure the
 * popover renders, plus the combined headline totals. Sorting lives here (the UI edge), not in the
 * model, because the alphabetical tie-break needs the resolved course name. Rows sort largest-gap
 * first: `missing` by hours-left (required − placed) desc, `over` by hours-over (placed − required)
 * desc, each tie broken by name asc. The two totals sum across cohorts and stay independent — the
 * non-netting invariant is inherited from `summarizeHours` upstream and never recombined here.
 */
export const buildCoursesLeftSummary = (inputs: CohortInput[]): CoursesLeftSummary => ({
  hoursLeft: inputs.reduce((sum, input) => sum + input.hoursLeft, 0),
  hoursOver: inputs.reduce((sum, input) => sum + input.hoursOver, 0),
  cohorts: inputs.map((input) => ({
    cohort: input.cohort,
    missing: toRows(input.unplaced, input.courseDisplay).sort(byGapThenName(hoursLeftOf)),
    over: toRows(input.overplaced, input.courseDisplay).sort(byGapThenName(hoursOverOf)),
  })),
});

// Resolve each course id to its display (name + color) at the edge; a fresh array, so the caller's
// in-place `.sort()` mutates nothing external (the model arrays stay untouched).
const toRows = (courses: CourseHours[], courseDisplay: Record<string, CourseDisplay>): CoursesLeftRow[] =>
  courses.map(({ courseId, placed, required }) => {
    const { name, color } = resolveCourseDisplay(courseDisplay, courseId);
    return { courseId, name, color, placed, required };
  });

const hoursLeftOf = (row: CoursesLeftRow): number => row.required - row.placed;
const hoursOverOf = (row: CoursesLeftRow): number => row.placed - row.required;

// Largest gap first, ties broken alphabetically by the resolved (display) name.
const byGapThenName =
  (gapOf: (row: CoursesLeftRow) => number) =>
  (a: CoursesLeftRow, b: CoursesLeftRow): number =>
    gapOf(b) - gapOf(a) || a.name.localeCompare(b.name);
