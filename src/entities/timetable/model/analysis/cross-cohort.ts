import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { lanesOf } from "./lanes";
import type { AnalyzerCourse, AnalyzerRow, CrossCohortFeatures, MirroredCell, TeacherDaySequence } from "./types";

/**
 * dp1 and dp2 are one staffing system (16 of 17 teachers work both), and the expert weaves them
 * deliberately: half the teacher-days stay cohort-pure, cross-cohort switches run at half the
 * engine's rate, and when a switch is unavoidable it hands off back-to-back instead of stranding
 * the teacher in a gap. None of it is in the objective, and none of it is derivable from the catalog.
 *
 * The mirrored-cell census is the payoff: cells where the SAME subject runs in BOTH cohorts at the
 * same day+period. In the gold plan all ten turned out to be the school's synchronized weekly
 * skeleton (the Monday Polish block, Advisory, the SSSTS morning, the paired CAS/EE cells) — inputs
 * in disguise, not preferences. So this census is an automatic **fixture detector**: run it on any
 * future expert plan and it names the pins the generator should have been given.
 *
 * Switches are read per teacher-day-**week** lane (a teacher can legally sit in both cohorts in one
 * cell only when the weeks differ — the SSSTS alternation — and that is not a switch); purity and
 * day counts are week-agnostic, matching the "a day is a day" reading of the report's 70 teacher-days.
 */
export const deriveCrossCohort = (
  courses: Record<Cohort, AnalyzerCourse[]>,
  rows: AnalyzerRow[],
): CrossCohortFeatures => {
  const catalog = indexCatalog(courses);
  const sequences = teacherDaySequences(rows, catalog);
  const switches = sequences.flatMap(switchesOf);
  const teacherDays = cohortsByTeacherDay(rows, catalog);
  const pureDays = [...teacherDays.values()].filter((cohorts) => cohorts.size === 1).length;
  const seamless = switches.filter((step) => step.seamless).length;

  return {
    teachers: catalog.teacherCohorts.size,
    teachersInBothCohorts: [...catalog.teacherCohorts.values()].filter((cohorts) => cohorts.size > 1).length,
    teacherDays: teacherDays.size,
    cohortPureTeacherDays: pureDays,
    cohortPureShare: share(pureDays, teacherDays.size),
    cohortSwitches: switches.length,
    seamlessSwitches: seamless,
    seamlessShare: share(seamless, switches.length),
    sharedSubjectEditionDays: sharedSubjectEditionDays(rows, catalog),
    mirroredCells: mirroredCells(rows, catalog),
  };
};

/** Course-id-keyed views of both catalogs — the analyzer's rows carry ids, everything else is a join. */
type CatalogIndex = {
  cohortOf: Map<string, Cohort>;
  teachersOf: Map<string, string[]>;
  subjectOf: Map<string, { name: string; level: string }>;
  teacherCohorts: Map<string, Set<Cohort>>;
};

const indexCatalog = (courses: Record<Cohort, AnalyzerCourse[]>): CatalogIndex => {
  const index: CatalogIndex = {
    cohortOf: new Map(),
    teachersOf: new Map(),
    subjectOf: new Map(),
    teacherCohorts: new Map(),
  };
  for (const cohort of COHORT_VALUES) {
    for (const course of courses[cohort]) {
      index.cohortOf.set(course.id, cohort);
      index.teachersOf.set(course.id, course.teacherKeys);
      index.subjectOf.set(course.id, { name: course.name, level: course.level });
      for (const teacher of course.teacherKeys) {
        const cohorts = index.teacherCohorts.get(teacher) ?? new Set<Cohort>();
        cohorts.add(cohort);
        index.teacherCohorts.set(teacher, cohorts);
      }
    }
  }
  return index;
};

/** One teacher's day in one week: their hours in period order, each tagged with the cohort it serves. */
const teacherDaySequences = (rows: AnalyzerRow[], catalog: CatalogIndex): TeacherDaySequence[] => {
  const byLane = new Map<string, TeacherDaySequence>();
  for (const row of rows) {
    for (const teacher of catalog.teachersOf.get(row.courseId) ?? []) {
      for (const weekLane of lanesOf(row.week)) {
        const key = `${teacher}|${row.day}|${weekLane}`;
        const sequence = byLane.get(key) ?? { teacher, day: row.day, weekLane, hours: [] };
        sequence.hours.push({ period: row.period, cohort: row.cohort });
        byLane.set(key, sequence);
      }
    }
  }
  return [...byLane.values()].map((sequence) => ({
    ...sequence,
    hours: [...sequence.hours].sort((a, b) => a.period - b.period),
  }));
};

type Switch = { seamless: boolean };

/** A switch is a step between two consecutive teaching hours whose cohorts differ; it is seamless
 *  when they sit in adjacent periods (the hand-off) rather than across an idle gap. */
const switchesOf = (sequence: TeacherDaySequence): Switch[] =>
  sequence.hours
    .slice(1)
    .map((hour, index) => ({ from: sequence.hours[index], to: hour }))
    .filter((step) => step.from.cohort !== step.to.cohort)
    .map((step) => ({ seamless: step.to.period - step.from.period === 1 }));

const cohortsByTeacherDay = (rows: AnalyzerRow[], catalog: CatalogIndex): Map<string, Set<Cohort>> => {
  const byDay = new Map<string, Set<Cohort>>();
  for (const row of rows) {
    for (const teacher of catalog.teachersOf.get(row.courseId) ?? []) {
      const key = `${teacher}|${row.day}`;
      const cohorts = byDay.get(key) ?? new Set<Cohort>();
      cohorts.add(row.cohort);
      byDay.set(key, cohorts);
    }
  }
  return byDay;
};

/** (teacher, subject, day) triples where the teacher runs BOTH cohorts' editions of a subject on the
 *  same day — the expert anti-batches these (37 vs the engine's 54); the motive is an expert question. */
const sharedSubjectEditionDays = (rows: AnalyzerRow[], catalog: CatalogIndex): number => {
  const cohortsByEditionDay = new Map<string, Set<Cohort>>();
  for (const row of rows) {
    const subject = catalog.subjectOf.get(row.courseId);
    if (!subject) continue;
    for (const teacher of catalog.teachersOf.get(row.courseId) ?? []) {
      const key = groupKey(teacher, subject.name, row.day);
      const cohorts = cohortsByEditionDay.get(key) ?? new Set<Cohort>();
      cohorts.add(row.cohort);
      cohortsByEditionDay.set(key, cohorts);
    }
  }
  return [...cohortsByEditionDay.values()].filter((cohorts) => cohorts.size > 1).length;
};

/** The fixture detector: same subject (name + level), same cell, both cohorts. Week-agnostic on
 *  purpose — the SSSTS and CAS/EE fixtures mirror ACROSS the week lanes (dp1 week A, dp2 week B). */
const mirroredCells = (rows: AnalyzerRow[], catalog: CatalogIndex): MirroredCell[] => {
  type Cell = { name: string; level: string; day: number; period: number; byCohort: Map<Cohort, string> };
  const byCell = new Map<string, Cell>();
  for (const row of rows) {
    const subject = catalog.subjectOf.get(row.courseId);
    if (!subject) continue;
    const key = groupKey(subject.name, subject.level, row.day, row.period);
    const cell = byCell.get(key) ?? { ...subject, day: row.day, period: row.period, byCohort: new Map() };
    cell.byCohort.set(row.cohort, row.courseId);
    byCell.set(key, cell);
  }
  return [...byCell.values()]
    .flatMap(({ byCohort, ...cell }) => {
      const dp1 = byCohort.get("dp1");
      const dp2 = byCohort.get("dp2");
      if (dp1 === undefined || dp2 === undefined) return [];
      return [{ ...cell, courseIds: { dp1, dp2 } }];
    })
    .sort((a, b) => a.day - b.day || a.period - b.period || a.name.localeCompare(b.name));
};

/** Course `name`/`level` are free text, so a `|`-joined key could collide (or mis-parse) — the parts
 *  are JSON-encoded instead, and identity is carried in the map VALUE rather than parsed back out. */
const groupKey = (...parts: (string | number)[]): string => JSON.stringify(parts);

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);
