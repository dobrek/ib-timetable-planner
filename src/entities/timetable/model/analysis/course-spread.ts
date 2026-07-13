import { groupByInto } from "@/shared/lib/collections";
import { distribution } from "./stats";
import type { AnalyzerRow, CourseSpreadFeatures, CourseTimeOfDay } from "./types";

/**
 * The other half of the course lens: how a course's hours spread across the week, and when in the
 * day they land. Spread is the natural counterweight to adjacency (4 hours on 4 days is maximally
 * spread; two doubles on two days is maximally paired), so the tension the objective will have to
 * price becomes measurable rather than argued.
 *
 * `meanPeriodByCourse` is the raw material for the time-of-day gradient the expert reads as a
 * heaviness map — rolled up to subject level by the subject roll-up lens.
 */
export const deriveCourseSpread = (rows: AnalyzerRow[]): CourseSpreadFeatures => {
  const daysByCourse = groupByInto(
    rows,
    (row) => row.courseId,
    (row) => row.day,
  );
  const daysUsed = [...daysByCourse.values()].map((days) => new Set(days).size);

  return {
    placedCourses: daysByCourse.size,
    multiDayCourses: daysUsed.filter((days) => days > 1).length,
    daysUsed: distribution(daysUsed),
    meanPeriodByCourse: meanPeriods(rows),
  };
};

const meanPeriods = (rows: AnalyzerRow[]): CourseTimeOfDay[] => {
  const periodsByCourse = groupByInto(
    rows,
    (row) => row.courseId,
    (row) => row.period,
  );
  return [...periodsByCourse].map(([courseId, periods]) => ({
    courseId,
    meanPeriod: periods.reduce((sum, period) => sum + period, 0) / periods.length,
  }));
};
