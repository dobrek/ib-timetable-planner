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
  /** courseId → cohort; when set, each occupant label gains a ` (DP1)`/`(DP2)` suffix. */
  cohortTag?: ReadonlyMap<string, Cohort>;
};

/**
 * Turn one view's live grid into styled sheet data — the pure heart of the XLSX export. Mirrors
 * `PlannerGrid`'s layout: a day-header row (each day spanning its cohort sub-columns in combined) and
 * an optional cohort sub-label row, then each period rendered as a **block of sub-rows** — one per
 * stacked occupant, mirroring the board's chips. Every occupant is its own cell (so each keeps its own
 * subject color); the time-range header is one cell that `rowSpan`s the period's sub-rows. Break-band
 * spacer rows follow P2/P5. Occupants come from `groupCellOccupants` with an **empty** collisions map,
 * so the snapshot is clean and name-sorted with zero new grouping logic. Framework-free: no browser
 * APIs and no `write-excel-file` import — the caller binds the library.
 */
export function buildTimetableSheet(input: TimetableSheetInput): TimetableSheet {
  const { days, periods, columns, cohortTag } = input;
  const multi = columns.length > 1;
  const dayList = rangeFrom1(days);
  const occupantsByColumn = columns.map((column) =>
    groupCellOccupants(column.placements, column.courseDisplay, EMPTY_COLLISIONS),
  );
  const totalColumns = 1 + days * columns.length;

  const rows: TimetableSheetCell[][] = [dayHeaderRow(dayList, columns.length, multi)];
  if (multi) rows.push(cohortLabelRow(dayList, columns));
  for (const period of rangeFrom1(periods)) {
    rows.push(...periodRows(period, dayList, occupantsByColumn, columns.length, cohortTag));
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

const BASE_BORDER = { borderStyle: "hair", borderColor: SHEET_BORDER_COLOR } as const;
/**
 * Stronger separators over the thin light-gray grid: a darker medium line closes each day column and
 * each period block; a darker thin line marks the cohort split within a day. Per-side overrides win
 * over `BASE_BORDER`, so a strong right/bottom coexists with the thin grid on the other sides.
 */
const SEPARATOR_COLOR = "#4B5563";
const DAY_RIGHT = { rightBorderStyle: "thin", rightBorderColor: SEPARATOR_COLOR } as const;
const COHORT_RIGHT = { rightBorderStyle: "hair", rightBorderColor: SEPARATOR_COLOR } as const;
const STRONG_BOTTOM = { bottomBorderStyle: "thin", bottomBorderColor: SEPARATOR_COLOR } as const;
/**
 * Break-band fill — the xlsx echo of the board's faint diagonal hatch (`bg-period-break`): a light
 * grey base under `lightUp` diagonal hatch lines in a mid grey, so the P2/P5 spacers read as an
 * intentional separator rather than a blank gap.
 */
const BREAK_FILL = {
  backgroundColor: "#F3F4F6",
  fillPatternStyle: "lightUp",
  fillPatternColor: "#9CA3AF",
} as const;
const TIME_COLUMN_WIDTH = 12;
const COURSE_COLUMN_WIDTH = 20;
const BREAK_ROW_HEIGHT = 10;
/** Read-only empty map → `groupCellOccupants` reports every occupant as un-collided (clean snapshot). */
const EMPTY_COLLISIONS = new Map<string, CellCollisions>();

const rangeFrom1 = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

const rangeFrom0 = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

const dayHeaderRow = (dayList: number[], subColumns: number, multi: boolean): TimetableSheetCell[] => {
  const headerEnd = !multi; // focus: the day-header row is the last (only) header row
  return [
    cornerCell(headerEnd),
    ...dayList.flatMap((day) => dayHeaderCells(dayLabel(day), multi ? subColumns : 1, headerEnd)),
  ];
};

const cohortLabelRow = (dayList: number[], columns: TimetableSheetColumn[]): TimetableSheetCell[] => [
  cornerCell(true), // combined: the cohort row is the last header row
  ...dayList.flatMap(() =>
    columns.map((column, index) => cohortLabelCell(cohortLabel(column.cohort), index === columns.length - 1)),
  ),
];

/** The right border of a content/label column: a strong day boundary, or the lighter cohort split. */
const columnRight = (isDayEnd: boolean) => (isDayEnd ? DAY_RIGHT : COHORT_RIGHT);

/**
 * One period as a block of sub-rows — as tall as the busiest cell in the period (≥ 1). Each sub-row
 * `i` holds the `i`-th occupant of every day×cohort cell (or an empty filler past that cell's count);
 * the time-range header sits in the first sub-row and `rowSpan`s the block (its column is `null` in
 * the following sub-rows, per the merge rule).
 */
const periodRows = (
  period: number,
  dayList: number[],
  occupantsByColumn: Map<string, CellOccupant[]>[],
  columnsPerDay: number,
  cohortTag: ReadonlyMap<string, Cohort> | undefined,
): TimetableSheetCell[][] => {
  const cells = dayList.flatMap((day) =>
    occupantsByColumn.map((occupants) => occupants.get(cellKey(day, period)) ?? []),
  );
  const height = Math.max(1, ...cells.map((occupants) => occupants.length));
  return rangeFrom0(height).map((subRow) => [
    subRow === 0 ? periodHeaderCell(period, height) : null,
    ...cells.map((occupants, index) =>
      contentCell(occupants[subRow], index % columnsPerDay === columnsPerDay - 1, subRow === height - 1, cohortTag),
    ),
  ]);
};

/** A hatched grey band across the full width (merged lead cell), closed by the same bottom rule as a
 *  period block — mirrors the board's faint diagonal break separator. */
const breakRow = (totalColumns: number): TimetableSheetCell[] => [
  { height: BREAK_ROW_HEIGHT, columnSpan: totalColumns, ...BREAK_FILL, ...STRONG_BOTTOM },
  ...Array.from({ length: totalColumns - 1 }, () => null),
];

/** The blank top-left cell; its right closes the frozen time-label column, its bottom the header block. */
const cornerCell = (headerEnd: boolean): Cell => ({
  ...BASE_BORDER,
  ...DAY_RIGHT,
  ...(headerEnd ? STRONG_BOTTOM : {}),
});

/**
 * A day header merged across its `span` cohort sub-columns (with `null` placeholders), closed by a
 * strong day boundary on the right; its bottom is strong only when it is the last header row (focus).
 */
const dayHeaderCells = (value: string, span: number, headerEnd: boolean): TimetableSheetCell[] => [
  {
    value,
    fontWeight: "bold",
    align: "center",
    ...BASE_BORDER,
    ...DAY_RIGHT,
    ...(headerEnd ? STRONG_BOTTOM : {}),
    ...(span > 1 ? { columnSpan: span } : {}),
  },
  ...Array.from({ length: span - 1 }, () => null),
];

/** A cohort sub-label; strong right at a day boundary, lighter at a cohort split; strong bottom (last header row). */
const cohortLabelCell = (value: string, isDayEnd: boolean): Cell => ({
  value,
  fontWeight: "bold",
  align: "center",
  ...BASE_BORDER,
  ...columnRight(isDayEnd),
  ...STRONG_BOTTOM,
});

/** The time-range row header, vertically centered and merged down the period's `height` sub-rows.
 *  Its right closes the label column; its bottom (carried onto the merge) closes the period block. */
const periodHeaderCell = (period: number, height: number): Cell => ({
  value: periodTimeLabel(period),
  fontWeight: "bold",
  align: "center",
  alignVertical: "center",
  ...(height > 1 ? { rowSpan: height } : {}),
  ...BASE_BORDER,
  ...DAY_RIGHT,
  ...STRONG_BOTTOM,
});

/** Time range (`08:00–08:45`); falls back to `periodLabel` past P10, where no time is defined. */
const periodTimeLabel = (period: number): string => {
  const range = periodTimeRange(period);
  return range ? `${range.start}–${range.end}` : periodLabel(period);
};

/**
 * One occupant's own cell, filled by its subject color (a missing occupant is an empty filler). A
 * strong right border closes its day column (lighter at a cohort split); a strong bottom closes the
 * period when this is its last sub-row.
 */
const contentCell = (
  occupant: CellOccupant | undefined,
  dayEnd: boolean,
  periodEnd: boolean,
  cohortTag: ReadonlyMap<string, Cohort> | undefined,
): Cell => {
  const fill = occupant ? subjectFill(occupant.color) : null;
  return {
    ...(occupant ? { value: occupantLabel(occupant, cohortTag) } : {}),
    ...BASE_BORDER,
    ...columnRight(dayEnd),
    ...(periodEnd ? STRONG_BOTTOM : {}),
    ...(fill ? { backgroundColor: fill.fill, textColor: fill.text } : {}),
  };
};

/**
 * The chip's text: name + week tag (`(A)`/`(B)`, nothing for `both`) + `(optional)` when flagged,
 * then a trailing ` (DP1)`/`(DP2)` when a `cohortTag` maps this occupant's course (the merged
 * teacher/student grid); absent the tag the label is unchanged (the board export).
 */
const occupantLabel = (occupant: CellOccupant, cohortTag: ReadonlyMap<string, Cohort> | undefined): string => {
  const { week, isOptional } = occupant.placement;
  const weekSuffix = week === "a" ? " (A)" : week === "b" ? " (B)" : "";
  const optionalSuffix = isOptional ? " (optional)" : "";
  const cohort = cohortTag?.get(occupant.placement.courseId);
  const cohortSuffix = cohort ? ` (${cohortLabel(cohort)})` : "";
  return `${occupant.name}${weekSuffix}${optionalSuffix}${cohortSuffix}`;
};

/** Per-occupant fill: the subject's hex pair, or `null` for a colorless course. */
const subjectFill = (color: SubjectColor | null): { fill: string; text: string } | null =>
  color ? SUBJECT_COLOR_HEX[color] : null;

const columnWidths = (totalColumns: number): { width: number }[] => [
  { width: TIME_COLUMN_WIDTH },
  ...Array.from({ length: totalColumns - 1 }, () => ({ width: COURSE_COLUMN_WIDTH })),
];
