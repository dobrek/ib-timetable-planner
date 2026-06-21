import type { Cohort, WeekMode } from "@/shared/config";

/**
 * View-models assembled server-side in `plans/[id]/courses.astro` and handed to the catalog
 * island. Projections of the generated DB rows — identity stays as opaque ids, display labels
 * resolved at the edge, never the raw `Database` row shape.
 */

/**
 * One course row in the catalog table. `isMerged` flags a composite merge parent (display
 * badge only). `overlaps` are the base-course ids this course depends on — its students
 * also attend those base courses (directed `course_overlaps`, this row is the dependent).
 */
export type CourseRow = {
  id: string;
  cohort: Cohort;
  name: string;
  level: string;
  groupIndex: number;
  hours: number;
  /** Fortnightly eligibility — `agnostic` (every week) or `biweekly` (week A or B only). */
  weekMode: WeekMode;
  /** The course's co-teacher ids (set; ≥1 for app-authored courses). */
  teacherIds: string[];
  /** Display labels for `teacherIds`, resolved at load (parallel array, same order). */
  teacherLabels: string[];
  isMerged: boolean;
  /** Child course ids when this row is a composite merge parent; empty otherwise. */
  mergeChildIds: string[];
  overlaps: string[];
};

/** Sentinel `level` value meaning "no level" — stored in the DB, rendered as "—". */
export const LEVEL_NONE = "none";

/** A selectable teacher for the multi-select filter and the create/edit form. */
export type TeacherOption = {
  id: string;
  label: string;
};
