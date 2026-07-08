import { cohortLabel } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { periodTimeRange } from "../../lib/period-times";
import type { PerspectiveCourseItem } from "../perspective-course-list";
import type { PlannerPlacement } from "../placement";
import { SHEET_BORDER_COLOR, type TimetableSheet, type TimetableSheetCell } from "./sheet-types";

export type PerspectiveCourseSheetInput = {
  item: PerspectiveCourseItem;
  /** Resolved display name (assembler passes `resolveCourseDisplay`, never a raw undefined). */
  courseName: string;
  level: string;
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  /** The viewer, excluded from the co-teachers line (teacher view); absent for the student view. */
  omitTeacherKey?: string;
};

/**
 * One person's course as a plain worksheet: a header block (name, cohort·level, hours, co-teachers,
 * occurrence times) over the assigned-student roster. Empty roster still renders — the header plus a
 * single "No students assigned." line — mirroring `buildRosterSheet`'s never-crash-on-empty contract.
 * Plain styling (no subject fills); framework-free with no `write-excel-file` import (the leaf binds it).
 */
export function buildPerspectiveCourseSheet(input: PerspectiveCourseSheetInput): TimetableSheet {
  const rows: TimetableSheetCell[][] = [
    [titleCell(input.courseName)],
    ...headerLines(input).map((line) => [textCell(line)]),
    [null],
    [sectionCell("Students")],
    ...rosterLines(input).map((name) => [textCell(name)]),
  ];
  return { rows, columns: COLUMN_WIDTHS, stickyRowsCount: 0, stickyColumnsCount: 0 };
}

/** A non-null cell — this sheet emits no span placeholders (the `null` above is a blank spacer row). */
type Cell = NonNullable<TimetableSheetCell>;

const COLUMN_WIDTHS = [{ width: 56 }];

/** The header block below the title: cohort·level, hours, co-teachers, occurrences — each an optional line. */
const headerLines = (input: PerspectiveCourseSheetInput): string[] => {
  const { item, level, teacherNames, omitTeacherKey } = input;
  const lines: string[] = [level ? `${cohortLabel(item.cohort)} · ${level}` : cohortLabel(item.cohort)];
  if (item.hours) lines.push(`Placed ${item.hours.placed} / Required ${item.hours.required}`);
  const coTeachers = coTeacherNames(item.teacherKeys, teacherNames, omitTeacherKey);
  if (coTeachers.length > 0) lines.push(`Co-teachers: ${coTeachers.join(", ")}`);
  const occurrences = item.occurrences.map(occurrenceLabel);
  if (occurrences.length > 0) lines.push(`Occurrences: ${occurrences.join(", ")}`);
  return lines;
};

/** Co-teacher names (viewer excluded), resolved to display names, name-sorted. */
const coTeacherNames = (
  teacherKeys: string[],
  teacherNames: Record<string, string>,
  omitTeacherKey: string | undefined,
): string[] =>
  teacherKeys
    .filter((key) => key !== omitTeacherKey)
    .map((key) => teacherNames[key] ?? key)
    .sort((a, b) => a.localeCompare(b));

/** `Mon P1 (08:00–08:45)`; drops the time range past P10, where none is defined. */
const occurrenceLabel = (placement: PlannerPlacement): string => {
  const range = periodTimeRange(placement.period);
  const time = range ? ` (${range.start}–${range.end})` : "";
  return `${dayLabel(placement.day)} ${periodLabel(placement.period)}${time}`;
};

/** The assigned students, resolved to names and sorted; the empty-roster note when none. */
const rosterLines = (input: PerspectiveCourseSheetInput): string[] => {
  const names = input.item.studentKeys.map((key) => input.studentNames[key] ?? key).sort((a, b) => a.localeCompare(b));
  return names.length > 0 ? names : ["No students assigned."];
};

const titleCell = (value: string): Cell => ({ value, fontWeight: "bold" });

const textCell = (value: string): Cell => ({ value });

const sectionCell = (value: string): Cell => ({
  value,
  fontWeight: "bold",
  bottomBorderStyle: "thin",
  bottomBorderColor: SHEET_BORDER_COLOR,
});
