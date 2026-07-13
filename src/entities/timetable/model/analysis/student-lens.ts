import { groupByInto } from "@/shared/lib/collections";
import { expandLanes, laneStats, type Lane, type LaneStats } from "./lanes";
import { distribution, worstOf } from "./stats";
import type { AnalyzerCourse, AnalyzerRow, StudentFeatures } from "./types";

/**
 * The tier-4 lens: what the week feels like from a desk. The objective already carries a
 * `studentHoles` term (dead last, and no LNS operator hunts it), and the v0 report found the
 * expert beats the engine by 35% on it anyway — a real human edge the search never contests.
 *
 * `gapSlots` is the same number `countStudentHoles` returns on the same input (a parity test pins
 * this): same student join, same lane expansion, same span − occupancy fold. Everything else here
 * is the distribution around that total — worst student, single-lesson days, span efficiency —
 * because the fairness question is always about the worst case, never the mean.
 *
 * Lanes are per student-day-**week**: a fully agnostic single-lesson day is one such day in each
 * week, so it counts twice. That is the student's real experience, and it keeps the total in step
 * with `countStudentHoles`.
 */
export const deriveStudentLens = (courses: AnalyzerCourse[], rows: AnalyzerRow[], periods: number): StudentFeatures => {
  const studentsOf = new Map(courses.map((course) => [course.id, course.studentKeys]));
  const enrolled = new Set(courses.flatMap((course) => course.studentKeys));
  const lanes = expandLanes(rows, (row) => studentsOf.get(row.courseId) ?? []).map(withStats);
  const holesByStudent = holesByEntity(lanes, enrolled);

  return {
    students: enrolled.size,
    gapSlots: lanes.reduce((sum, lane) => sum + lane.stats.holes, 0),
    gapsPerStudent: distribution([...holesByStudent.values()]),
    worstStudentGaps: worstOf([...holesByStudent].map(([key, value]) => ({ key, value }))),
    hoursPerStudentDay: distribution(lanes.map((lane) => lane.stats.count)),
    spanEfficiency: distribution(lanes.map((lane) => lane.stats.count / lane.stats.span)),
    maxConsecutiveHours: distribution(lanes.map((lane) => lane.stats.maxStreak)),
    singleLessonDays: lanes.filter((lane) => lane.stats.count === 1).length,
    earlyStarts: distribution(lanes.map((lane) => lane.stats.first - 1)),
    lateFinishes: distribution(lanes.map((lane) => periods - lane.stats.last)),
    daysOnCampus: distribution(daysPerStudent(courses, rows)),
  };
};

type StatLane = Lane & { stats: LaneStats };

const withStats = (lane: Lane): StatLane => ({ ...lane, stats: laneStats(lane.periods) });

/** Gaps per student, seeded with every enrolled student — a student whose courses are all unplaced
 *  sits at 0 gaps rather than dropping out of the distribution (an incomplete board must not read
 *  as a compact one for the students it stranded). */
const holesByEntity = (lanes: StatLane[], enrolled: Set<string>): Map<string, number> => {
  const totals = new Map([...enrolled].map((student) => [student, 0]));
  for (const lane of lanes) {
    totals.set(lane.entityKey, (totals.get(lane.entityKey) ?? 0) + lane.stats.holes);
  }
  return totals;
};

/** Distinct days a student is on campus — week-agnostic: a day is a trip in, whichever week it runs. */
const daysPerStudent = (courses: AnalyzerCourse[], rows: AnalyzerRow[]): number[] => {
  const studentsOf = new Map(courses.map((course) => [course.id, course.studentKeys]));
  const daysByStudent = groupByInto(
    rows.flatMap((row) => (studentsOf.get(row.courseId) ?? []).map((student) => ({ student, day: row.day }))),
    (entry) => entry.student,
    (entry) => entry.day,
  );
  return [...daysByStudent.values()].map((days) => new Set(days).size);
};
