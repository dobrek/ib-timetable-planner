/**
 * View-models assembled server-side in `courses.astro` and handed to the catalog island.
 * Projections of the generated DB rows (lessons: "domain projection") — identity stays as
 * opaque ids, display labels resolved at the edge, never the raw `Database` row shape.
 */

/** One course row in the catalog table. `isMerged` rows render read-only (no edit/delete/overlap). */
export type CourseRow = {
  id: string;
  cohortId: string;
  name: string;
  level: string;
  groupIndex: number;
  hours: number;
  teacherId: string | null;
  teacherLabel: string | null;
  isMerged: boolean;
};

/** A cohort presented as a tab. `label` is the school-year display ("Year 1" / "Year 2"). */
export type CohortTab = {
  id: string;
  label: string;
};

/** A selectable teacher for the multi-select filter and the create/edit form. */
export type TeacherOption = {
  id: string;
  label: string;
};
