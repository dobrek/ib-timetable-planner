import type { StudentRow } from "./student";

/** One add-course line in the confirmation step: how many selected students would gain it. */
export type BulkChoiceGain = { courseId: string; gains: number };
/** One remove-course line: how many selected students currently hold it and would lose it. */
export type BulkChoiceLoss = { courseId: string; losses: number };

export type BulkChoiceSummary = {
  studentCount: number;
  adds: BulkChoiceGain[];
  removes: BulkChoiceLoss[];
};

/**
 * Pure confirmation-step computation from already-loaded rows — the safety mechanism that
 * replaces undo. For each add-course, how many selected students are currently missing it
 * (would gain it); for each remove-course, how many currently hold it (would lose it). Zero
 * counts are meaningful output — "0 students have TOK2" is the story's assurance — so every
 * requested course yields a line and none is filtered out.
 */
export const summarizeBulkChoices = (
  students: readonly StudentRow[],
  addCourseIds: readonly string[],
  removeCourseIds: readonly string[],
): BulkChoiceSummary => {
  const holderCount = (courseId: string): number =>
    students.filter((student) => student.choiceCourseIds.includes(courseId)).length;

  return {
    studentCount: students.length,
    adds: addCourseIds.map((courseId) => ({ courseId, gains: students.length - holderCount(courseId) })),
    removes: removeCourseIds.map((courseId) => ({ courseId, losses: holderCount(courseId) })),
  };
};
