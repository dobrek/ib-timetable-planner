import type { Cohort } from "@/shared/config";

/**
 * View-models assembled server-side in `plans/[id]/teachers.astro` and handed to the
 * catalog island. Projections of the generated DB rows — identity stays as opaque ids,
 * display labels resolved at the edge, never the raw `Database` row shape.
 */

/** One course assignment for badge display and workload totals. */
export type CourseAssignment = {
  id: string;
  cohort: Cohort;
  name: string;
  level: string;
  groupIndex: number;
  hours: number;
};

/**
 * One teacher row in the catalog table. `assignments` are read-only projections of
 * courses where `teacher_id` points at this teacher, grouped by cohort in the UI.
 */
export type TeacherRow = {
  id: string;
  code: string;
  fullName: string | null;
  assignments: CourseAssignment[];
};
