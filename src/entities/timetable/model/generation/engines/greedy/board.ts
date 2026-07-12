import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { cellKey } from "../../../collision/cell-key";
import type { GeneratedPlacement } from "../../types";
import type { Problem } from "./problem";

/** One occupant row inside a cell: the course, its concrete week, and whether it is an immovable
 *  pin (pins are indexed but never live in the generated-output list). */
export type Row = { courseId: string; week: PlacementWeek; pinned: boolean };

/**
 * The mutable working board for one attempt — six cross-referential indexes behind a small
 * behavioral contract. `place`/`evict` keep every index AND the generated-output list in lockstep,
 * collapsing the four hand-written index+push / unindex+remove call sites the closure used to
 * repeat; `fitsAt` is the single feasibility predicate (the five hard rules, the 2/day cap, and the
 * flagged-edge invariant). A behavioral contract (method members), not a data shape — but expressed
 * as a `type` because the flat ESLint config enforces `consistent-type-definitions: type`.
 */
export type Board = {
  /** Per-course hours still to place — mutated by the stages, read by candidate selection. */
  readonly remaining: Map<string, number>;
  /** The generated placements accumulated so far (the attempt's output list). */
  readonly placements: GeneratedPlacement[];
  /** Index a placement into every axis; a non-pinned placement also joins `placements`. */
  place(cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek, pinned?: boolean): void;
  /** Remove a generated placement from every axis and from `placements`; returns the removed row. */
  evict(cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek): GeneratedPlacement;
  /** The week a course may take at (d, p) — hard rules + flagged-edge — or null if it cannot fit. */
  fitsAt(cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null;
  /** Cells (in interior-first order) that currently hold ≥1 row, optionally excluding one cellKey. */
  usedCells(cohort: Cohort, excludeKey?: string): { d: number; p: number }[];
  /** The occupant rows at (cohort, d, p) — the live array, empty when the cell is unoccupied. */
  rowsAt(cohort: Cohort, d: number, p: number): Row[];
};

export const createBoard = (problem: Problem): Board => {
  const { courseById, flagged, strongNo, cellOrder } = problem;

  // --- mutable indexes -------------------------------------------------------------
  const remaining = new Map<string, number>();
  const generated: GeneratedPlacement[] = [];
  /** teacherKey|cellKey|week → courseId (global across cohorts = cross-cohort rule). */
  const teacherAt = new Map<string, string>();
  /** cohort|student|day|week → period → courseId (single owner per lane by construction). */
  const studentAt = new Map<string, Map<number, string>>();
  /** cohort|cellKey → occupant rows (pins + generated). */
  const cellRows = new Map<string, Row[]>();
  /** courseId|day|week → same-day count (the hard 2/day cap). */
  const dayCount = new Map<string, number>();

  const index = (
    cohort: Cohort,
    courseId: string,
    d: number,
    p: number,
    week: PlacementWeek,
    pinned: boolean,
  ): void => {
    const course = courseById.get(courseId);
    if (!course) return; // catalog-missing pin — nothing to attribute (mirrors bucketByCell)
    const ck = cellKey(d, p);
    for (const w of weeksOf(week)) {
      for (const t of course.teacherKeys) teacherAt.set(`${t}|${ck}|${w}`, courseId);
      for (const s of course.studentKeys) {
        const sdKey = studentKeyOf(cohort, s, d, w);
        const byPeriod = studentAt.get(sdKey) ?? new Map<number, string>();
        if (!studentAt.has(sdKey)) studentAt.set(sdKey, byPeriod);
        byPeriod.set(p, courseId);
      }
      dayCount.set(`${courseId}|${d}|${w}`, (dayCount.get(`${courseId}|${d}|${w}`) ?? 0) + 1);
    }
    const rowsKey = `${cohort}|${ck}`;
    const rows = cellRows.get(rowsKey) ?? [];
    if (!cellRows.has(rowsKey)) cellRows.set(rowsKey, rows);
    rows.push({ courseId, week, pinned });
  };

  const unindex = (cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek): void => {
    const course = courseById.get(courseId);
    if (!course) return;
    const ck = cellKey(d, p);
    for (const w of weeksOf(week)) {
      for (const t of course.teacherKeys) teacherAt.delete(`${t}|${ck}|${w}`);
      for (const s of course.studentKeys) studentAt.get(studentKeyOf(cohort, s, d, w))?.delete(p);
      const dk = `${courseId}|${d}|${w}`;
      dayCount.set(dk, (dayCount.get(dk) ?? 0) - 1);
    }
    const rows = cellRows.get(`${cohort}|${ck}`);
    if (rows) removeWhere(rows, (r) => r.courseId === courseId, `cell row ${cohort} ${courseId} @ ${ck}`);
  };

  const place = (cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek, pinned = false): void => {
    index(cohort, courseId, d, p, week, pinned);
    if (!pinned) generated.push({ cohort, courseId, day: d, period: p, week });
  };

  const evict = (cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek): GeneratedPlacement => {
    unindex(cohort, courseId, d, p, week);
    return removeWhere(
      generated,
      (x) => x.cohort === cohort && x.courseId === courseId && x.day === d && x.period === p,
      `generated row ${courseId} @ ${cellKey(d, p)}`,
    );
  };

  const feasibleWeek = (cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null => {
    const ck = cellKey(d, p);
    if (cellRows.get(`${cohort}|${ck}`)?.some((r) => r.courseId === course.id)) return null;
    const options: PlacementWeek[] = course.weekMode === "biweekly" ? ["a", "b"] : ["both"];
    outer: for (const week of options) {
      for (const w of weeksOf(week)) {
        if ((dayCount.get(`${course.id}|${d}|${w}`) ?? 0) >= 2) continue outer;
        for (const t of course.teacherKeys) {
          if (strongNo.get(t)?.has(ck)) continue outer;
          if (teacherAt.has(`${t}|${ck}|${w}`)) continue outer;
        }
        for (const s of course.studentKeys) {
          if (studentAt.get(studentKeyOf(cohort, s, d, w))?.has(p)) continue outer;
        }
      }
      return week;
    }
    return null;
  };

  /**
   * The flagged-edge invariant at a single placement site, delta-aware — the one predicate that
   * closes the boxing bug across every stage (pins included). Placing `course` at (d, p, week)
   * must not push a flagged row that shares a student — the candidate itself, a pin, or a
   * generated row — from a day edge into the strict interior. Per enrolled student's day-week lane:
   *   1. if the candidate is flagged, it must land at an edge among the lane's *other* courses
   *      (the core's `early-finish-edge` rule for the placed row);
   *   2. every flagged occupant already in the lane that was at an edge must stay at an edge once
   *      the candidate joins at period `p`.
   * A flagged row already interior *before* the placement (a dirty board that slipped past the
   * worker precondition) is left untouched rather than poisoning every placement for that
   * student-day (delta semantics — reject only newly-boxed rows).
   */
  const flaggedEdgeOk = (
    cohort: Cohort,
    course: GroupingCourse,
    d: number,
    p: number,
    week: PlacementWeek,
  ): boolean => {
    for (const w of weeksOf(week)) {
      for (const s of course.studentKeys) {
        const lane = studentAt.get(studentKeyOf(cohort, s, d, w));
        if (!lane) continue;
        const occupants = [...lane]; // [period, courseId] — single owner per period
        if (flagged.has(course.id) && strictlyInterior(p, othersOf(occupants, course.id))) return false;
        for (const [q, owner] of occupants) {
          if (owner === course.id || !flagged.has(owner)) continue;
          const others = othersOf(occupants, owner);
          if (!strictlyInterior(q, others) && strictlyInterior(q, [...others, p])) return false;
        }
      }
    }
    return true;
  };

  const fitsAt = (cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null => {
    const week = feasibleWeek(cohort, course, d, p);
    if (!week) return null;
    return flaggedEdgeOk(cohort, course, d, p, week) ? week : null;
  };

  const usedCells = (cohort: Cohort, excludeKey?: string): { d: number; p: number }[] =>
    cellOrder.filter(({ d, p }) => {
      const ck = cellKey(d, p);
      return ck !== excludeKey && (cellRows.get(`${cohort}|${ck}`)?.length ?? 0) > 0;
    });

  const rowsAt = (cohort: Cohort, d: number, p: number): Row[] => cellRows.get(`${cohort}|${cellKey(d, p)}`) ?? [];

  return { remaining, placements: generated, place, evict, fitsAt, usedCells, rowsAt };
};

const weeksOf = (week: PlacementWeek): ("a" | "b")[] => (week === "both" ? ["a", "b"] : [week]);

const studentKeyOf = (cohort: Cohort, student: string, d: number, w: string): string =>
  `${cohort}|${student}|${d}|${w}`;

/** Periods a student's day-week lane holds via courses *other than* `courseId` (≤2/day each). */
const othersOf = (occupants: [number, string][], courseId: string): number[] =>
  occupants.filter(([, owner]) => owner !== courseId).map(([period]) => period);

/** True when `period` sits strictly between the min and max of `others` (empty ⇒ not interior). */
const strictlyInterior = (period: number, others: number[]): boolean =>
  others.length > 0 && period > Math.min(...others) && period < Math.max(...others);

/**
 * Remove and return the first element matching `match`, throwing on not-found — the eviction
 * sites rely on the row existing (an invariant that spans a stale shuffled copy plus a `visited`
 * set), and a silent `splice(findIndex → -1)` drops the LAST element instead, corrupting the
 * board. The worker's catch turns the throw into a clean failure rather than corrupt output.
 */
const removeWhere = <T>(items: T[], match: (item: T) => boolean, label: string): T => {
  const at = items.findIndex(match);
  if (at === -1) throw new Error(`generation invariant violated: ${label} not found for removal`);
  return items.splice(at, 1)[0];
};
