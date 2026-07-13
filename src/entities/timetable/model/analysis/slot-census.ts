import { cellKey } from "../collision/cell-key";
import { distribution } from "./stats";
import type { AnalyzerCourse, AnalyzerRow, SlotCensusFeatures, SlotPosition, ThinSlot } from "./types";

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
 * the union) — the same convention as `countOccupiedSlots`.
 */

/** A slot serving at most this share of the cohort is "thin" — the report's convention. */
export const THIN_SLOT_SHARE = 0.25;

export const deriveSlotCensus = (courses: AnalyzerCourse[], rows: AnalyzerRow[]): SlotCensusFeatures => {
  const studentsOf = new Map(courses.map((course) => [course.id, course.studentKeys]));
  const cohortStudents = new Set(courses.flatMap((course) => course.studentKeys)).size;
  const cells = occupiedCells(rows);
  const occupants = cells.map((cell) => ({
    ...cell,
    students: new Set(cell.courseIds.flatMap((courseId) => studentsOf.get(courseId) ?? [])).size,
  }));
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
  };
};

type OccupiedCell = { day: number; period: number; courseIds: string[] };

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

/** Where the cell sits in its day's used span. A single-lesson day reads as `start`. */
const positionOf = (rows: AnalyzerRow[], day: number, period: number): SlotPosition => {
  const periods = rows.filter((row) => row.day === day).map((row) => row.period);
  if (period === Math.min(...periods)) return "start";
  if (period === Math.max(...periods)) return "end";
  return "interior";
};

const byDayThenPeriod = (a: ThinSlot, b: ThinSlot): number => a.day - b.day || a.period - b.period;
