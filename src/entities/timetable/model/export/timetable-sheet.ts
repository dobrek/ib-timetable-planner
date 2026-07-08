import { cohortLabel, SUBJECT_COLOR_HEX, type Cohort, type SubjectColor } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { periodTimeRange } from "../../lib/period-times";
import { breaksAfterPeriod } from "../../lib/period-breaks";
import { cellKey } from "../collision/cell-key";
import type { CellCollisions } from "../collision/collisions";
import { groupCellOccupants, type CellOccupant } from "../collision/cell-occupants";
import type { CourseDisplay } from "../course-display";
import type { LocalPlacement } from "../placement";
import { SHEET_BORDER_COLOR, type TimetableSheet, type TimetableSheetCell } from "./sheet-types";

/** One exported cohort column: its live placements + display map, same shape as `PlannerGrid`'s columns. */
export type TimetableSheetColumn = {
  cohort: Cohort;
  placements: LocalPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
};

export type TimetableSheetInput = {
  days: number;
  periods: number;
  /** One column in focus mode, two (dp1, dp2) in combined. */
  columns: TimetableSheetColumn[];
};

/**
 * Turn one view's live grid into styled sheet data — the pure heart of the XLSX export. Mirrors
 * `PlannerGrid`'s layout: a day-header row (each day spanning its cohort sub-columns in combined), an
 * optional cohort sub-label row, then period rows headed by their time range, with break-band spacer
 * rows after P2/P5. Occupants come from `groupCellOccupants` with an **empty** collisions map, so the
 * snapshot is clean and name-sorted with zero new grouping logic. Framework-free: no browser APIs and
 * no `write-excel-file` import — the caller binds the library.
 */
export function buildTimetableSheet(input: TimetableSheetInput): TimetableSheet {
  const { days, periods, columns } = input;
  const multi = columns.length > 1;
  const dayList = rangeFrom1(days);
  const occupantsByColumn = columns.map((column) =>
    groupCellOccupants(column.placements, column.courseDisplay, EMPTY_COLLISIONS),
  );
  const totalColumns = 1 + days * columns.length;

  const rows: TimetableSheetCell[][] = [dayHeaderRow(dayList, columns.length, multi)];
  if (multi) rows.push(cohortLabelRow(dayList, columns));
  for (const period of rangeFrom1(periods)) {
    rows.push(periodRow(period, dayList, occupantsByColumn));
    if (breaksAfterPeriod(period, periods)) rows.push(breakRow(totalColumns));
  }

  return {
    rows,
    columns: columnWidths(totalColumns),
    stickyRowsCount: multi ? 2 : 1,
    stickyColumnsCount: 1,
  };
}

/** A non-null cell — the builders always produce one; `null` appears only as a span placeholder. */
type Cell = NonNullable<TimetableSheetCell>;

const BOX_BORDER = { borderStyle: "thin", borderColor: SHEET_BORDER_COLOR } as const;
const TIME_COLUMN_WIDTH = 12;
const COURSE_COLUMN_WIDTH = 18;
const BREAK_ROW_HEIGHT = 6;
/** Read-only empty map → `groupCellOccupants` reports every occupant as un-collided (clean snapshot). */
const EMPTY_COLLISIONS = new Map<string, CellCollisions>();

const rangeFrom1 = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

const dayHeaderRow = (dayList: number[], subColumns: number, multi: boolean): TimetableSheetCell[] => [
  cornerCell(),
  ...dayList.flatMap((day) => spannedHeader(dayLabel(day), multi ? subColumns : 1)),
];

const cohortLabelRow = (dayList: number[], columns: TimetableSheetColumn[]): TimetableSheetCell[] => [
  cornerCell(),
  ...dayList.flatMap(() => columns.map((column) => headerCell(cohortLabel(column.cohort)))),
];

const periodRow = (
  period: number,
  dayList: number[],
  occupantsByColumn: Map<string, CellOccupant[]>[],
): TimetableSheetCell[] => [
  periodHeaderCell(period),
  ...dayList.flatMap((day) =>
    occupantsByColumn.map((occupants) => contentCell(occupants.get(cellKey(day, period)) ?? [])),
  ),
];

/** A short empty band across the full width (height on the merged lead cell) — mirrors the board break. */
const breakRow = (totalColumns: number): TimetableSheetCell[] => [
  { height: BREAK_ROW_HEIGHT, columnSpan: totalColumns },
  ...Array.from({ length: totalColumns - 1 }, () => null),
];

const cornerCell = (): Cell => ({ ...BOX_BORDER });

const headerCell = (value: string): Cell => ({ value, fontWeight: "bold", align: "center", ...BOX_BORDER });

/** A header cell merged across `span` sub-columns, followed by its `span − 1` `null` placeholders. */
const spannedHeader = (value: string, span: number): TimetableSheetCell[] => [
  { ...headerCell(value), ...(span > 1 ? { columnSpan: span } : {}) },
  ...Array.from({ length: span - 1 }, () => null),
];

const periodHeaderCell = (period: number): Cell => ({
  value: periodTimeLabel(period),
  fontWeight: "bold",
  align: "center",
  ...BOX_BORDER,
});

/** Time range (`08:00–08:45`); falls back to `periodLabel` past P10, where no time is defined. */
const periodTimeLabel = (period: number): string => {
  const range = periodTimeRange(period);
  return range ? `${range.start}–${range.end}` : periodLabel(period);
};

const contentCell = (occupants: CellOccupant[]): Cell => {
  if (occupants.length === 0) return { ...BOX_BORDER };
  const fill = occupants.length === 1 ? subjectFill(occupants[0].color) : null;
  return {
    value: occupants.map(occupantLabel).join("\n"),
    ...BOX_BORDER,
    ...(occupants.length > 1 ? { wrap: true } : {}),
    ...(fill ? { backgroundColor: fill.fill, textColor: fill.text } : {}),
  };
};

/** The chip's text: name + week tag (`(A)`/`(B)`, nothing for `both`) + `(optional)` when flagged. */
const occupantLabel = (occupant: CellOccupant): string => {
  const { week, isOptional } = occupant.placement;
  const weekSuffix = week === "a" ? " (A)" : week === "b" ? " (B)" : "";
  const optionalSuffix = isOptional ? " (optional)" : "";
  return `${occupant.name}${weekSuffix}${optionalSuffix}`;
};

/** Fill only for a single occupant with a color; multi-occupant / colorless cells stay neutral. */
const subjectFill = (color: SubjectColor | null): { fill: string; text: string } | null =>
  color ? SUBJECT_COLOR_HEX[color] : null;

const columnWidths = (totalColumns: number): { width: number }[] => [
  { width: TIME_COLUMN_WIDTH },
  ...Array.from({ length: totalColumns - 1 }, () => ({ width: COURSE_COLUMN_WIDTH })),
];
