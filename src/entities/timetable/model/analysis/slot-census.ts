import { cellKey } from "../collision/cell-key";
import { GOLDEN_BAND } from "../generation/golden-sets";
import { lanesOf, type WeekLane } from "./lanes";
import { distribution } from "./stats";
import type {
  AnalyzerCourse,
  AnalyzerRow,
  GoldenCell,
  GoldenCensusFeatures,
  SlotCensusFeatures,
  SlotPosition,
} from "./types";

/**
 * The transpose of the lane primitive: cell → occupants. Answers "what does this slot buy us" —
 * how many students it serves and how many courses run in parallel.
 *
 * The v0 report's negative result is baked into the shape: slot density is NOT an expert
 * objective (the expert's median students-per-slot is *lower* than the engine's, and every thin
 * slot turned out to be a deliberate edge double). So thin slots are reported **with their
 * position** in the day's span — measuring *where* they sit, not merely how many exist.
 *
 * Cells are week-agnostic (an `a` and a `b` row in one cell are one slot, and its occupants are
 * the union) — the same convention as `countOccupiedSlots`. The golden census below is the one
 * exception, and it says why.
 */

/** A slot serving at most this share of the cohort is "thin" — the report's convention. */
export const THIN_SLOT_SHARE = 0.25;

/** A cell missing at most this share of the cohort is "near-golden". The expert's own answer to
 *  "how close is *almost* every student?" — "1–2 students, max 10%" — so this is elicited, not
 *  guessed: it admits ≥25/27 in dp1 and ≥31/34 in dp2. */
export const NEAR_GOLDEN_MISS_SHARE = 0.1;

export const deriveSlotCensus = (courses: AnalyzerCourse[], rows: AnalyzerRow[]): SlotCensusFeatures => {
  const studentsOf = new Map(courses.map((course) => [course.id, course.studentKeys]));
  const cohortStudents = new Set(courses.flatMap((course) => course.studentKeys)).size;
  const cells = occupiedCells(rows);
  const occupants = cells.map((cell) => ({ ...cell, students: coverageOf(cell.courseIds, studentsOf) }));
  const thinThreshold = cohortStudents * THIN_SLOT_SHARE;

  return {
    cohortStudents,
    studentsPerSlot: distribution(occupants.map((cell) => cell.students)),
    coursesPerSlot: distribution(occupants.map((cell) => cell.courseIds.length)),
    thinSlotShare: THIN_SLOT_SHARE,
    thinSlots: occupants
      .filter((cell) => cell.students <= thinThreshold)
      .map(({ day, period, students }) => ({ day, period, students, position: positionOf(rows, day, period) }))
      .sort(byDayThenPeriod),
    goldenCensus: deriveGoldenCensus(cells, rows, studentsOf, cohortStudents),
  };
};

/**
 * The coverage tail of the census: cells whose parallel occupants together cover the whole cohort
 * (English A + English B, TOK with distinct teachers, or a composite of 3+ courses). The expert's
 * golden rule is *finding* these and centring them mid-day — a full-coverage cell placed mid-span
 * can never punch a student window, which is what makes the "peak" a mechanism rather than a taste.
 *
 * **Coverage is measured per week lane** — the one place this module departs from its week-agnostic
 * cell convention. A cell's occupants in lane `a` may differ from lane `b` (the expert's `BM SL +
 * CAS(a) + EE(b) + TOK` composite is golden only because *each* lane completes the roster), and a
 * cell covering everyone in week A but half the cohort in week B is not a moment when every student
 * is in class — it is that only every other week. So a cell takes its **worst** lane, and a cell
 * running in one lane only can never be golden (in the other, its students are free). Cell identity
 * stays week-agnostic, which is what makes the count comparable with the manual SQL census.
 */
const deriveGoldenCensus = (
  cells: OccupiedCell[],
  rows: AnalyzerRow[],
  studentsOf: Map<string, string[]>,
  cohortStudents: number,
): GoldenCensusFeatures => {
  const coverage = cohortStudents === 0 ? [] : coverageCells(cells, rows, studentsOf, cohortStudents);
  const golden = coverage.filter((cell) => cell.missing === 0).sort(byDayThenPeriod);
  const inBand = golden.filter((cell) => cell.inBand).length;

  return {
    golden,
    nearGolden: coverage
      .filter((cell) => cell.missing > 0 && cell.missing <= cohortStudents * NEAR_GOLDEN_MISS_SHARE)
      .sort(byDayThenPeriod),
    composites: golden.filter((cell) => cell.courses >= COMPOSITE_COURSES).length,
    meanPeriod: distribution(golden.map((cell) => cell.period)).mean,
    goldenInBand: inBand,
    bandShare: golden.length === 0 ? 0 : inBand / golden.length,
    band: GOLDEN_BAND,
    missShare: NEAR_GOLDEN_MISS_SHARE,
  };
};

/** A golden cell assembled from at least this many parallel courses is a *composite* — the class
 *  of golden slot only the expert builds (English A+B and TOK unions arise incidentally). */
const COMPOSITE_COURSES = 3;

type OccupiedCell = { day: number; period: number; courseIds: string[] };

/** Every occupied cell scored by its worst week lane. */
const coverageCells = (
  cells: OccupiedCell[],
  rows: AnalyzerRow[],
  studentsOf: Map<string, string[]>,
  cohortStudents: number,
): GoldenCell[] => {
  const laneCourses = courseIdsByLaneCell(rows);
  return cells.map((cell) => {
    const students = Math.min(
      ...lanesOf("both").map((lane) => coverageOf(laneCourses.get(laneKey(cell, lane)) ?? [], studentsOf)),
    );
    return {
      day: cell.day,
      period: cell.period,
      courses: cell.courseIds.length,
      students,
      missing: cohortStudents - students,
      inBand: cell.period >= GOLDEN_BAND.first && cell.period <= GOLDEN_BAND.last,
    };
  });
};

const occupiedCells = (rows: AnalyzerRow[]): OccupiedCell[] => {
  const byCell = new Map<string, OccupiedCell>();
  for (const row of rows) {
    const key = cellKey(row.day, row.period);
    const cell = byCell.get(key) ?? { day: row.day, period: row.period, courseIds: [] };
    if (!cell.courseIds.includes(row.courseId)) cell.courseIds.push(row.courseId);
    byCell.set(key, cell);
  }
  return [...byCell.values()];
};

/** The same grouping, split by week lane — a `both`-week row lives in BOTH lanes (`lanesOf`). */
const courseIdsByLaneCell = (rows: AnalyzerRow[]): Map<string, string[]> => {
  const byLaneCell = new Map<string, string[]>();
  for (const row of rows) {
    for (const lane of lanesOf(row.week)) {
      const key = laneKey(row, lane);
      const courseIds = byLaneCell.get(key) ?? [];
      if (!courseIds.includes(row.courseId)) courseIds.push(row.courseId);
      byLaneCell.set(key, courseIds);
    }
  }
  return byLaneCell;
};

/** Distinct students the given courses serve — the union, because a cell's occupants run in parallel. */
const coverageOf = (courseIds: string[], studentsOf: Map<string, string[]>): number =>
  new Set(courseIds.flatMap((courseId) => studentsOf.get(courseId) ?? [])).size;

/** Where the cell sits in its day's used span. A single-lesson day reads as `start`. */
const positionOf = (rows: AnalyzerRow[], day: number, period: number): SlotPosition => {
  const periods = rows.filter((row) => row.day === day).map((row) => row.period);
  if (period === Math.min(...periods)) return "start";
  if (period === Math.max(...periods)) return "end";
  return "interior";
};

const laneKey = (cell: { day: number; period: number }, lane: WeekLane): string =>
  `${cellKey(cell.day, cell.period)}|${lane}`;

/** Reading order for every cell list this module emits (thin slots and golden cells alike). */
const byDayThenPeriod = (a: CellPosition, b: CellPosition): number => a.day - b.day || a.period - b.period;

type CellPosition = { day: number; period: number };
