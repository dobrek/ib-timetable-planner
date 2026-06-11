/**
 * View-models assembled server-side in `students.astro` and handed to the catalog island.
 * Projections of the generated DB rows — identity stays as opaque ids, display labels
 * resolved at the edge (in the loader), never the raw `Database` row shape.
 */

/**
 * One student row in the catalog table. `choiceCourseIds` are the ids of the courses this
 * student chose; labels are resolved against the shared `coursesById` lookup in the UI.
 */
export type StudentRow = {
  id: string;
  cohortId: string;
  fullName: string;
  choiceCourseIds: string[];
};

/**
 * A selectable course for the choice picker, filter, and badge display. `label` is
 * formatted once in the loader; `isMergeParent` flags composite parents that students
 * never choose directly (excluded from picker and filter).
 */
export type CourseOption = {
  id: string;
  cohortId: string;
  label: string;
  isMergeParent: boolean;
};
