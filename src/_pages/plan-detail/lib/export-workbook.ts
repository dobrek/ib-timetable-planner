import { cohortLabel, type Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import {
  buildRosterSheet,
  buildTimetableSheet,
  type CourseDisplay,
  type HoursStat,
  type LocalPlacement,
  type TimetableSheet,
  type TimetableSheetColumn,
} from "@/entities/timetable";
import type { BoardSurface } from "./board-surface";
import { exportFileName } from "./export-file-name";

/**
 * One cohort's live board + catalog slice — the pieces needed to build its grid column and roster sheet.
 * `hours` (live `state.hours`) is inert for the view exports here but carried so this one coherent live
 * slice also feeds the batch export's per-teacher perspective workbooks (`buildBatchExportWorkbooks`).
 */
export type ExportCohortData = {
  cohort: Cohort;
  placements: LocalPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
  catalog: GroupingCourse[];
  studentNames: Record<string, string>;
  hours: Map<string, HoursStat>;
};

export type ExportWorkbookInput = {
  planName: string;
  view: BoardSurface;
  days: number;
  periods: number;
  teacherNames: Record<string, string>;
  dp1: ExportCohortData;
  dp2: ExportCohortData;
};

/** A `write-excel-file` sheet descriptor — the shape its multi-sheet call takes (`rows` → `data`). */
export type WorkbookSheet = {
  data: TimetableSheet["rows"];
  sheet: string;
  columns: TimetableSheet["columns"];
  stickyRowsCount: number;
  stickyColumnsCount: number;
};

/**
 * Assemble the ordered sheets + filename for one exported view — the pure glue between the live board
 * and `write-excel-file`. The timetable grid comes first (both cohort columns in combined, one in
 * focus), then one subject roster per exported cohort. Framework-free and library-free: the caller
 * (`ExportMenu`) hands `sheets` to the library and only IT binds the dependency, so this stays testable
 * and reusable. Sheet names: `"Combined"` / `cohortLabel` for the grid; `` `${cohortLabel} subjects` ``
 * for rosters.
 */
export const buildExportWorkbook = (input: ExportWorkbookInput): { sheets: WorkbookSheet[]; fileName: string } => {
  const cohorts = exportedCohorts(input);
  const timetable = buildTimetableSheet({ days: input.days, periods: input.periods, columns: cohorts.map(toColumn) });
  const rosters = cohorts.map((cohort) =>
    descriptor(
      buildRosterSheet({
        catalog: cohort.catalog,
        courseDisplay: cohort.courseDisplay,
        teacherNames: input.teacherNames,
        studentNames: cohort.studentNames,
      }),
      `${cohortLabel(cohort.cohort)} subjects`,
    ),
  );

  return {
    sheets: [descriptor(timetable, gridSheetName(input.view)), ...rosters],
    fileName: exportFileName(input.planName, input.view),
  };
};

/** The exported cohorts for a view: both in combined, the focused one otherwise. */
const exportedCohorts = (input: ExportWorkbookInput): ExportCohortData[] =>
  input.view === "combined" ? [input.dp1, input.dp2] : [input.view === "dp1" ? input.dp1 : input.dp2];

const gridSheetName = (view: BoardSurface): string => (view === "combined" ? "Combined" : cohortLabel(view));

const toColumn = (cohort: ExportCohortData): TimetableSheetColumn => ({
  cohort: cohort.cohort,
  placements: cohort.placements,
  courseDisplay: cohort.courseDisplay,
});

const descriptor = (sheet: TimetableSheet, name: string): WorkbookSheet => ({
  data: sheet.rows,
  sheet: name,
  columns: sheet.columns,
  stickyRowsCount: sheet.stickyRowsCount,
  stickyColumnsCount: sheet.stickyColumnsCount,
});
