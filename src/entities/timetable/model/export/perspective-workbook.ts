import type { Cohort } from "@/shared/config";
import { resolveCourseDisplay, type CourseDisplay } from "../course-display";
import type { PerspectiveCourseItem } from "../perspective-course-list";
import type { PlannerPlacement } from "../placement";
import { buildPerspectiveCourseSheet } from "./perspective-course-sheet";
import { courseSheetName, dedupeSheetNames } from "./sheet-name";
import { buildTimetableSheet } from "./timetable-sheet";
import type { TimetableSheet } from "./sheet-types";

/** One cohort's slice of a person's plan — placements MUST be pre-narrowed by the caller to the person's own courses. */
export type PerspectiveWorkbookCohort = {
  cohort: Cohort;
  placements: PlannerPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
};

export type PerspectiveWorkbookInput = {
  planName: string;
  /** Slug component after the plan slug — the teacher code now, a student code later. */
  fileCode: string;
  days: number;
  periods: number;
  cohorts: PerspectiveWorkbookCohort[];
  /** Merged display map across cohorts — for resolving per-course sheet names. */
  courseDisplay: Record<string, CourseDisplay>;
  /** courseId → level (structural; deliberately NOT the widget `CourseInfo`). */
  courseLevels: Record<string, string>;
  items: PerspectiveCourseItem[];
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  /** Teacher view: exclude self from each course's co-teachers line. */
  omitTeacherKey?: string;
  gridSheetName?: string;
};

/** A named worksheet — the leaf renames `sheet.rows` → the library's `data` and passes `name` as the sheet name. */
export type NamedSheet = { name: string; sheet: TimetableSheet };

/**
 * Compose the ordered sheets + filename for one person's plan — the pure, persona-agnostic glue between
 * the perspective data and `write-excel-file`. The merged, cohort-tagged grid comes first, then one
 * plain sheet per course in a deterministic `(cohort, name)` order with sanitized, de-duplicated tab
 * names. Teacher vs student is only a matter of the inputs (whose placements/items, and `omitTeacherKey`);
 * the caller narrows placements to the person's own courses. Library-free: the leaf binds the dependency.
 */
export const buildPerspectiveWorkbook = (
  input: PerspectiveWorkbookInput,
): { sheets: NamedSheet[]; fileName: string } => ({
  sheets: [buildGridSheet(input), ...buildCourseSheets(input)],
  fileName: `${slugify(input.planName)}-${slugify(input.fileCode)}.xlsx`,
});

/** The merged teacher/student grid: both cohorts' placements unioned into one column, cohort-tagged per course. */
const buildGridSheet = (input: PerspectiveWorkbookInput): NamedSheet => {
  const union = input.cohorts.flatMap((cohort) => cohort.placements);
  const mergedDisplay: Record<string, CourseDisplay> = Object.fromEntries(
    input.cohorts.flatMap((cohort) => Object.entries(cohort.courseDisplay)),
  );
  const cohortTag = new Map<string, Cohort>(
    input.cohorts.flatMap((cohort) =>
      cohort.placements.map((placement) => [placement.courseId, cohort.cohort] as const),
    ),
  );
  const sheet = buildTimetableSheet({
    days: input.days,
    periods: input.periods,
    columns: [{ cohort: input.cohorts[0].cohort, placements: union, courseDisplay: mergedDisplay }],
    cohortTag,
  });
  return { name: input.gridSheetName ?? "Timetable", sheet };
};

/** One sheet per course in `(cohort, name)` order, with sanitized, de-duplicated tab names. */
const buildCourseSheets = (input: PerspectiveWorkbookInput): NamedSheet[] => {
  const sorted = [...input.items].sort((a, b) => compareItems(a, b, input.courseDisplay));
  const names = dedupeSheetNames(
    sorted.map((item) => courseSheetName(courseNameOf(item, input.courseDisplay), item.cohort)),
  );
  return sorted.map((item, index) => ({
    name: names[index],
    sheet: buildPerspectiveCourseSheet({
      item,
      courseName: courseNameOf(item, input.courseDisplay),
      level: input.courseLevels[item.courseId] ?? "",
      teacherNames: input.teacherNames,
      studentNames: input.studentNames,
      omitTeacherKey: input.omitTeacherKey,
    }),
  }));
};

/** Resolve a display name via the shared resolver — a catalog-absent merge child degrades to its bare id. */
const courseNameOf = (item: PerspectiveCourseItem, courseDisplay: Record<string, CourseDisplay>): string =>
  resolveCourseDisplay(courseDisplay, item.courseId).name;

const compareItems = (
  a: PerspectiveCourseItem,
  b: PerspectiveCourseItem,
  courseDisplay: Record<string, CourseDisplay>,
): number => {
  if (a.cohort !== b.cohort) return a.cohort.localeCompare(b.cohort);
  const byName = courseNameOf(a, courseDisplay).localeCompare(courseNameOf(b, courseDisplay));
  return byName !== 0 ? byName : a.courseId.localeCompare(b.courseId);
};

/** Lowercase, non-alphanumerics → `-`, trimmed; empty falls back to `plan` (mirrors `export-file-name.ts`). */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "plan";
