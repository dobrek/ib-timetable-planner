import type { CourseMerge, PlanTeacher } from "@/shared/api";
import { slugify } from "@/shared/lib/slugify";
import {
  buildPerspectiveCourseItems,
  buildPerspectiveWorkbook,
  perspectivePlacements,
  teacherCourses,
  type CourseDisplay,
  type HoursStat,
  type NamedSheet,
} from "@/entities/timetable";
import { buildExportWorkbook, type ExportCohortData, type WorkbookSheet } from "./export-workbook";

/**
 * The three extra SSR reads the board loader performs for the batch export, threaded to the island as
 * one prop (deliberately OFF `SharedBoardProps`, which feeds the drag/board hooks and their fixtures).
 * The pure batch assembly below and the `ExportMenu` leaf both consume it from `lib/`.
 */
export type BatchExportSources = {
  teachers: PlanTeacher[];
  merges: CourseMerge[];
  /** courseId → level (structural), for the per-course perspective sheet headers. */
  courseLevels: Record<string, string>;
};

/**
 * One cohort's LIVE board slice for the batch — the existing export slice plus live `state.hours`, which
 * `buildPerspectiveCourseItems` needs so per-course occurrence/hours reflect unsaved optimistic edits.
 */
export type BatchExportCohort = ExportCohortData & { hours: Map<string, HoursStat> };

export type BatchExportInput = {
  planName: string;
  days: number;
  periods: number;
  teacherNames: Record<string, string>;
  dp1: BatchExportCohort;
  dp2: BatchExportCohort;
  batch: BatchExportSources;
};

/** One workbook already in the `write-excel-file` descriptor shape — ready for the leaf to serialize. */
export type BatchExportFile = { fileName: string; sheets: WorkbookSheet[] };

export type BatchExportResult = { zipFileName: string; files: BatchExportFile[] };

/**
 * Assemble the combined-plan workbook plus one perspective workbook per conducting teacher, from LIVE
 * board state, in one pure call — the framework-free heart of the batch export. Reuses the shipped
 * builders (`buildExportWorkbook` for the combined file, `buildPerspectiveWorkbook` per teacher) with no
 * new sheet logic. Order: combined first, then teachers in loader order; teachers with zero conducted
 * courses are skipped (mirroring the single-teacher button's self-disable). Every returned file is already
 * a `write-excel-file` descriptor list, so the `ExportMenu` leaf serializes uniformly; in-archive filename
 * collisions are deduped case-insensitively with a numeric suffix. Library-free: the leaf binds the deps.
 */
export const buildBatchExportWorkbooks = (input: BatchExportInput): BatchExportResult => {
  const combined = buildExportWorkbook({
    planName: input.planName,
    view: "combined",
    days: input.days,
    periods: input.periods,
    teacherNames: input.teacherNames,
    dp1: input.dp1,
    dp2: input.dp2,
  });

  const courseDisplay = { ...input.dp1.courseDisplay, ...input.dp2.courseDisplay };
  const studentNames = { ...input.dp1.studentNames, ...input.dp2.studentNames };

  const teacherFiles = input.batch.teachers
    .map((teacher) => teacherWorkbook(teacher, input, courseDisplay, studentNames))
    .filter((file): file is BatchExportFile => file !== null);

  const files = dedupeFileNames([{ fileName: combined.fileName, sheets: combined.sheets }, ...teacherFiles]);
  return { zipFileName: `${slugify(input.planName)}.zip`, files };
};

/**
 * One teacher's perspective workbook from live state, or `null` when they conduct no courses. Items come
 * from BOTH cohorts' full catalogs (live placements, live hours, merges resolved to children); the grid
 * placements are narrowed to the teacher's own courses via `teacherCourses` → `perspectivePlacements`.
 */
const teacherWorkbook = (
  teacher: PlanTeacher,
  input: BatchExportInput,
  courseDisplay: Record<string, CourseDisplay>,
  studentNames: Record<string, string>,
): BatchExportFile | null => {
  const taughtBy = (course: { teacherKeys: string[] }): boolean => course.teacherKeys.includes(teacher.id);
  const items = [
    ...buildPerspectiveCourseItems({
      cohort: "dp1",
      courses: input.dp1.catalog,
      placements: input.dp1.placements,
      merges: input.batch.merges,
      hours: input.dp1.hours,
      memberOf: taughtBy,
    }),
    ...buildPerspectiveCourseItems({
      cohort: "dp2",
      courses: input.dp2.catalog,
      placements: input.dp2.placements,
      merges: input.batch.merges,
      hours: input.dp2.hours,
      memberOf: taughtBy,
    }),
  ];
  if (items.length === 0) return null;

  const dp1CourseIds = new Set(teacherCourses(input.dp1.catalog, teacher.id).map((course) => course.id));
  const dp2CourseIds = new Set(teacherCourses(input.dp2.catalog, teacher.id).map((course) => course.id));

  const { sheets, fileName } = buildPerspectiveWorkbook({
    planName: input.planName,
    fileCode: teacher.code,
    days: input.days,
    periods: input.periods,
    cohorts: [
      {
        cohort: "dp1",
        placements: perspectivePlacements(input.dp1.placements, dp1CourseIds),
        courseDisplay: input.dp1.courseDisplay,
      },
      {
        cohort: "dp2",
        placements: perspectivePlacements(input.dp2.placements, dp2CourseIds),
        courseDisplay: input.dp2.courseDisplay,
      },
    ],
    courseDisplay,
    courseLevels: input.batch.courseLevels,
    items,
    teacherNames: input.teacherNames,
    studentNames,
    omitTeacherKey: teacher.id,
  });
  return { fileName, sheets: sheets.map(toDescriptor) };
};

/** `NamedSheet` → the library's descriptor shape (`sheet.rows` → `data`), mirroring the single-export leaf. */
const toDescriptor = ({ name, sheet }: NamedSheet): WorkbookSheet => ({
  data: sheet.rows,
  sheet: name,
  columns: sheet.columns,
  stickyRowsCount: sheet.stickyRowsCount,
  stickyColumnsCount: sheet.stickyColumnsCount,
});

/**
 * Case-insensitive in-archive filename de-dup: the first occurrence keeps its name; each later collision
 * gets a `-2`/`-3`/… suffix before the extension. Sequential scan (each pick depends on all prior picks),
 * mirroring the sheet-name dedupe convention.
 */
const dedupeFileNames = (files: BatchExportFile[]): BatchExportFile[] => {
  const used = new Set<string>();
  return files.map((file) => {
    const unique = disambiguateFileName(file.fileName, used, files.length + 1);
    used.add(unique.toLowerCase());
    return { ...file, fileName: unique };
  });
};

/** The first non-colliding name for `fileName`: itself, else `<base>-n<ext>` up to `limit` (always terminates). */
const disambiguateFileName = (fileName: string, used: Set<string>, limit: number): string => {
  if (!used.has(fileName.toLowerCase())) return fileName;
  const { base, ext } = splitExtension(fileName);
  for (let n = 2; n <= limit; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${limit + 1}${ext}`;
};

/** Split off the final `.ext` (e.g. `plan-abc.xlsx` → `plan-abc` + `.xlsx`); no dot → whole name, empty ext. */
const splitExtension = (fileName: string): { base: string; ext: string } => {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? { base: fileName, ext: "" } : { base: fileName.slice(0, dot), ext: fileName.slice(dot) };
};
