import { groupByInto } from "@/shared/lib/collections";
import { deriveCourseAdjacency } from "./course-adjacency";
import type { AnalyzerCourse, AnalyzerRow, SubjectRollup } from "./types";

/**
 * Course-grain numbers rolled up to subject level — chiefly the **time-of-day gradient** (mean
 * period per subject: SSSTS 1.5 in the morning … Chemistry 6.3 in the afternoon), which is the
 * expert's raw input for labeling which subjects are "heavy" and belong early. That labeling is a
 * T3 metric the analyzer cannot compute; this gradient is what makes the conversation possible.
 *
 * Subjects span both cohorts (a subject has a dp1 edition and a dp2 edition), so the roll-up is
 * board-wide.
 *
 * The grouping key is **provisional**: `name` today (Math AA HL and Math AA SL roll up together),
 * pending the expert's confirmation of whether level and group index separate a subject. It is a
 * single injectable function so the decision costs one argument, not a refactor.
 */

/** The provisional subject key — `name` alone, ignoring level and group index. */
export const subjectByName = (course: AnalyzerCourse): string => course.name;

export const deriveSubjectRollup = (
  courses: AnalyzerCourse[],
  rows: AnalyzerRow[],
  subjectKey: (course: AnalyzerCourse) => string = subjectByName,
): SubjectRollup[] => {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const subjectOf = (row: AnalyzerRow): string | null => {
    const course = courseById.get(row.courseId);
    return course ? subjectKey(course) : null;
  };
  const rowsBySubject = groupByInto(rows, subjectOf, (row) => row, { skipNullKeys: true });
  const coursesBySubject = groupByInto(courses, subjectKey, (course) => course.id);

  return [...rowsBySubject]
    .map(([subject, subjectRows]) => {
      // Adjacency stays at courseId grain inside the subject: two editions of one subject are
      // different students, so their hours never pair with each other.
      const adjacency = deriveCourseAdjacency(subjectRows);
      return {
        subject,
        courses: coursesBySubject.get(subject)?.length ?? 0,
        placedHours: subjectRows.length,
        meanPeriod: mean(subjectRows.map((row) => row.period)),
        adjacentPairs: adjacency.adjacentPairs,
        sameDaySplits: adjacency.sameDaySplits,
      };
    })
    .sort((a, b) => a.meanPeriod - b.meanPeriod || a.subject.localeCompare(b.subject));
};

const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
