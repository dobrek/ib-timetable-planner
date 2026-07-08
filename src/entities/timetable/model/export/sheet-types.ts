/**
 * Structural output types for the workbook transforms (`buildTimetableSheet`, `buildRosterSheet`).
 *
 * These are declared **locally** — deliberately NOT imported from `write-excel-file` — so
 * `entities/timetable` stays dependency-free and importable from any runtime (the future
 * server-side batch-export path, a Worker route, a test). The shapes are a structural subset of
 * `write-excel-file`'s cell-object / sheet-descriptor API, so the single call site in
 * `_pages/plan-detail` can hand them to the library with only a field rename (`rows` → `data`) and
 * no value mapping. Property names (`backgroundColor`, `textColor`, `columnSpan`, `borderStyle`, …)
 * match the library exactly — confirmed against its docs. Both transforms return the same
 * `TimetableSheet` shape (the roster is just a different sheet of the same workbook).
 */

/** Shared grid-line / rule color for both transforms (a neutral light gray; xlsx has no theme). */
export const SHEET_BORDER_COLOR = "#D1D5DB";

/** Horizontal alignment — the subset the transforms use. */
export type TimetableSheetAlign = "left" | "center" | "right";

/**
 * One styled cell. `null` is a spanned-cell placeholder: a cell carrying `columnSpan: n` must be
 * followed by `n − 1` `null`s in the same row, or downstream columns shift. `value` is string-only
 * (numbers are pre-formatted to text) to keep the transforms uniform and pure.
 */
export type TimetableSheetCell = {
  value?: string;
  fontWeight?: "bold";
  align?: TimetableSheetAlign;
  /** Text wraps within the cell (multi-occupant timetable cells, people lists). */
  wrap?: boolean;
  /** Cell fill (hex), e.g. a single subject's color. */
  backgroundColor?: string;
  /** Font color (hex), paired with `backgroundColor`. */
  textColor?: string;
  /** Merge this cell across `columnSpan` columns; emit `columnSpan − 1` trailing `null`s. */
  columnSpan?: number;
  /** Row height (points) — set on any one cell to size that row (break-band spacers). */
  height?: number;
  /** Thin box border on all four sides. */
  borderStyle?: "thin";
  borderColor?: string;
  /** Bottom-only rule (the roster header underline). */
  bottomBorderStyle?: "thin";
  bottomBorderColor?: string;
} | null;

/** A worksheet: its 2D cell grid plus per-column widths and frozen-pane counts. The call site maps
 *  `rows` → the library's `data` and names the sheet. Shared by both workbook transforms. */
export type TimetableSheet = {
  rows: TimetableSheetCell[][];
  columns: { width: number }[];
  stickyRowsCount: number;
  stickyColumnsCount: number;
};
