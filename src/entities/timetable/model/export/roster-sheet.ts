import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { resolveCourseDisplay, type CourseDisplay } from "../course-display";
import { SHEET_BORDER_COLOR, type TimetableSheet, type TimetableSheetCell } from "./sheet-types";

export type RosterSheetInput = {
  /** The cohort's validation catalog — ALL subjects, placed or not (decision). */
  catalog: GroupingCourse[];
  courseDisplay: Record<string, CourseDisplay>;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
};

/**
 * One cohort's full subject list as a flat worksheet — every catalog subject (placed or not) with its
 * assigned teachers and students resolved to names, plus weekly hours. A plain list (no color fills),
 * sorted by display name. Same purity constraints as `buildTimetableSheet`: framework-free, no library
 * import. An empty catalog yields the header row only — a valid sheet, no crash.
 */
export function buildRosterSheet(input: RosterSheetInput): TimetableSheet {
  const { catalog, courseDisplay, teacherNames, studentNames } = input;
  const sorted = [...catalog].sort((a, b) => compareBySubject(a, b, courseDisplay));
  return {
    rows: [headerRow(), ...sorted.map((course) => subjectRow(course, courseDisplay, teacherNames, studentNames))],
    columns: COLUMN_WIDTHS,
    stickyRowsCount: 1,
    stickyColumnsCount: 0,
  };
}

/** A non-null cell — the roster never emits span placeholders. */
type Cell = NonNullable<TimetableSheetCell>;

const COLUMN_WIDTHS = [{ width: 28 }, { width: 30 }, { width: 60 }, { width: 10 }];

const headerRow = (): TimetableSheetCell[] => ["Subject", "Teachers", "Students", "Hours/week"].map(headerCell);

const headerCell = (value: string): Cell => ({
  value,
  fontWeight: "bold",
  bottomBorderStyle: "thin",
  bottomBorderColor: SHEET_BORDER_COLOR,
});

const subjectRow = (
  course: GroupingCourse,
  courseDisplay: Record<string, CourseDisplay>,
  teacherNames: Record<string, string>,
  studentNames: Record<string, string>,
): TimetableSheetCell[] => [
  { value: resolveCourseDisplay(courseDisplay, course.id).name },
  peopleCell(course.teacherKeys, teacherNames),
  peopleCell(course.studentKeys, studentNames),
  { value: String(course.hours), align: "right" },
];

/** Keys → resolved names (raw key when unmapped), name-sorted, comma-joined, wrapped. */
const peopleCell = (keys: string[], names: Record<string, string>): Cell => ({
  value: keys
    .map((key) => names[key] ?? key)
    .sort((a, b) => a.localeCompare(b))
    .join(", "),
  wrap: true,
});

const compareBySubject = (
  a: GroupingCourse,
  b: GroupingCourse,
  courseDisplay: Record<string, CourseDisplay>,
): number => {
  const byName = resolveCourseDisplay(courseDisplay, a.id).name.localeCompare(
    resolveCourseDisplay(courseDisplay, b.id).name,
  );
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
};
