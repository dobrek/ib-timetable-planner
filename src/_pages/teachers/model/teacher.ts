import type { AvailabilitySeverity, Cohort } from "@/shared/config";

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
 * One constrained availability cell for a teacher: the `(day, period)` the teacher
 * cannot teach (`strong`) or prefers not to (`soft`). Cohort-independent — it applies
 * to whatever cohort the board renders. Absence of a cell means available.
 */
export type TeacherAvailabilityCell = { day: number; period: number; severity: AvailabilitySeverity };

/**
 * One teacher row in the catalog table. `assignments` are read-only projections of the
 * courses linked to this teacher via the `course_teachers` junction, grouped by cohort in
 * the UI. `availability` is the teacher's constrained cells, edited via the availability dialog.
 */
export type TeacherRow = {
  id: string;
  code: string;
  fullName: string | null;
  assignments: CourseAssignment[];
  availability: TeacherAvailabilityCell[];
};
