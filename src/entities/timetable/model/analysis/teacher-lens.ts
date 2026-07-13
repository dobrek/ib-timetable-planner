import { buildAvailabilityIndex, type BoardAvailabilityCell } from "../availability-index";
import { cellKey } from "../collision/cell-key";
import { expandLanes, laneStats } from "./lanes";
import { distribution, worstOf } from "./stats";
import type { AnalyzerCourse, AnalyzerRow, Extreme, TeacherFeatures } from "./types";

/**
 * The biggest unmodeled dimension of the whole diff: teacher gap-slots ran 74 (expert) vs 345
 * (engine) on identical inputs, and the `Objective` tuple has **no teacher term at all**.
 *
 * Teacher lanes span BOTH cohorts — 16 of 17 teachers teach dp1 and dp2, so a teacher's day is one
 * day, not two half-days (the premise the cross-cohort lens builds on). Gaps/spans/streaks are
 * lane-expanded (span − occupancy, mirroring `countStudentHoles`); teaching-days and daily load are
 * week-agnostic, because a day a teacher comes in is a day whichever week it runs.
 *
 * Availability hits localize `verifyGeneration`'s board-wide `softWarnCount` to a teacher: the
 * expert took ZERO soft hits in 248 placements, the engine took 3 oracle-legal ones.
 */
export const deriveTeacherLens = (
  courses: AnalyzerCourse[],
  rows: AnalyzerRow[],
  availability: BoardAvailabilityCell[],
): TeacherFeatures => {
  const teachersOf = new Map(courses.map((course) => [course.id, course.teacherKeys]));
  const staff = new Set(courses.flatMap((course) => course.teacherKeys));
  const lanes = expandLanes(rows, (row) => teachersOf.get(row.courseId) ?? []).map((lane) => ({
    ...lane,
    stats: laneStats(lane.periods),
  }));
  const gapsByTeacher = totalsBy(staff, lanes, (lane) => lane.stats.holes);
  const dayLoads = teacherDayLoads(staff, rows, teachersOf);
  const hits = availabilityHits(rows, teachersOf, availability);

  return {
    teachers: staff.size,
    gapSlots: lanes.reduce((sum, lane) => sum + lane.stats.holes, 0),
    gapsPerTeacher: distribution([...gapsByTeacher.values()]),
    worstTeacherGaps: worstOf(asExtremes(gapsByTeacher)),
    teachingDays: distribution([...dayLoads.daysPerTeacher.values()]),
    hoursPerTeachingDay: distribution(dayLoads.hoursPerDay),
    daySpan: distribution(lanes.map((lane) => lane.stats.span)),
    maxConsecutiveTeaching: distribution(lanes.map((lane) => lane.stats.maxStreak)),
    softAvailabilityHits: hits.soft.length,
    strongAvailabilityHits: hits.strong.length,
    softHitsByTeacher: countByTeacher(hits.soft),
  };
};

type StatLane = { entityKey: string; day: number; stats: { holes: number; span: number; maxStreak: number } };

/** Every teacher on staff is ranked, including one with an empty board (0 gaps, 0 days). */
const totalsBy = (staff: Set<string>, lanes: StatLane[], pick: (lane: StatLane) => number): Map<string, number> => {
  const totals = new Map([...staff].map((teacher) => [teacher, 0]));
  for (const lane of lanes) totals.set(lane.entityKey, (totals.get(lane.entityKey) ?? 0) + pick(lane));
  return totals;
};

/** Days-in per teacher (week-agnostic) and the hours each of those days carries (one row = one hour). */
const teacherDayLoads = (
  staff: Set<string>,
  rows: AnalyzerRow[],
  teachersOf: Map<string, string[]>,
): { daysPerTeacher: Map<string, number>; hoursPerDay: number[] } => {
  const hoursByTeacherDay = new Map<string, number>();
  for (const row of rows) {
    for (const teacher of teachersOf.get(row.courseId) ?? []) {
      const key = `${teacher}|${row.day}`;
      hoursByTeacherDay.set(key, (hoursByTeacherDay.get(key) ?? 0) + 1);
    }
  }
  const daysPerTeacher = new Map([...staff].map((teacher) => [teacher, 0]));
  for (const key of hoursByTeacherDay.keys()) {
    const teacher = key.split("|")[0];
    daysPerTeacher.set(teacher, (daysPerTeacher.get(teacher) ?? 0) + 1);
  }
  return { daysPerTeacher, hoursPerDay: [...hoursByTeacherDay.values()] };
};

/** One entry per (placement, teacher) landing on a cell the teacher declared unavailable.
 *  Availability is authored week-agnostically, so a `both` row is one hit, not two. */
const availabilityHits = (
  rows: AnalyzerRow[],
  teachersOf: Map<string, string[]>,
  availability: BoardAvailabilityCell[],
): { soft: string[]; strong: string[] } => {
  const index = buildAvailabilityIndex(availability);
  const hits = rows.flatMap((row) =>
    (teachersOf.get(row.courseId) ?? []).map((teacher) => ({ teacher, cell: cellKey(row.day, row.period) })),
  );
  return {
    soft: hits
      .filter((hit) => index.softUnavailableByTeacher.get(hit.teacher)?.has(hit.cell))
      .map((hit) => hit.teacher),
    strong: hits
      .filter((hit) => index.strongUnavailableByTeacher.get(hit.teacher)?.has(hit.cell))
      .map((hit) => hit.teacher),
  };
};

const countByTeacher = (teachers: string[]): Extreme[] => {
  const counts = new Map<string, number>();
  for (const teacher of teachers) counts.set(teacher, (counts.get(teacher) ?? 0) + 1);
  return asExtremes(counts).sort((a, b) => b.value - a.value);
};

const asExtremes = (totals: Map<string, number>): Extreme[] => [...totals].map(([key, value]) => ({ key, value }));
