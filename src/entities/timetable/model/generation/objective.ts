import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { countOccupiedSlots } from "./occupied-slots";
import type { CourseDeficit, GeneratedPlacement, GeneratorSnapshot } from "./types";

/**
 * The engine-agnostic definition of board quality: the lexicographic objective, its comparator, and
 * the candidate-scoring function every engine (and the benchmark) must agree on. Lives outside any
 * engine so a second engine and the bench score against the *same* tiers rather than a private copy.
 * Depends only on the snapshot + a placement set + the per-course remaining hours — no engine state.
 */

const COHORT_ORDER: Cohort[] = ["dp1", "dp2"];

/** The lexicographic objective tuple: `[unplacedTotal, holes, totalSlots, studentHoles]` —
 *  completeness > interior holes > slot count > student compactness, compared tier-by-tier. */
export type Objective = [unplacedTotal: number, holes: number, totalSlots: number, studentHoles: number];

/** A scored board: its placements, objective tuple, per-cohort slots/unplaced, and the per-course
 *  hours still unplaced — with `placements`, the full state an LNS round rehydrates. */
export type Candidate = {
  placements: GeneratedPlacement[];
  objective: Objective;
  slots: Record<Cohort, number>;
  unplaced: Record<Cohort, CourseDeficit[]>;
  remaining: Map<string, number>;
};

/**
 * Lexicographic comparison of two objective tuples — the priority tiers hold at ANY magnitude
 * (the weighted scalar it replaces let a studentHoles term in the hundreds outvote a whole slot).
 * Negative ⇒ `a` is the better board (smaller-is-better on every tier); shared by cross-attempt
 * selection and the LNS acceptance test so the two never disagree.
 */
export const compareObjectives = (a: Objective, b: Objective): number => {
  for (let tier = 0; tier < a.length; tier++) {
    if (a[tier] !== b[tier]) return a[tier] - b[tier];
  }
  return 0;
};

/**
 * Score a placement set against the snapshot into a `Candidate`. Reads only the snapshot (catalog,
 * pins, days) plus the caller's `remaining` map — no engine internals — so any engine can call it.
 */
export const scoreCandidate = (
  snapshot: GeneratorSnapshot,
  generated: GeneratedPlacement[],
  remaining: Map<string, number>,
): Candidate => {
  const slots = {} as Record<Cohort, number>;
  const unplaced = {} as Record<Cohort, CourseDeficit[]>;
  let holes = 0;
  let studentHoles = 0;
  for (const cohort of COHORT_ORDER) {
    const rows = [...snapshot.cohorts[cohort].pins, ...generated.filter((x) => x.cohort === cohort)];
    slots[cohort] = countOccupiedSlots(rows);
    unplaced[cohort] = snapshot.cohorts[cohort].courses
      .filter((c) => (remaining.get(c.id) ?? 0) > 0)
      .map((c) => ({ courseId: c.id, missing: remaining.get(c.id) ?? 0 }));
    holes += countInteriorHoles(rows, snapshot.days);
    studentHoles += countStudentHoles(snapshot.cohorts[cohort].courses, rows);
  }
  const unplacedTotal = COHORT_ORDER.reduce(
    (sum, cohort) => sum + unplaced[cohort].reduce((s, d) => s + d.missing, 0),
    0,
  );
  const totalSlots = COHORT_ORDER.reduce((sum, cohort) => sum + slots[cohort], 0);
  const objective: Objective = [unplacedTotal, holes, totalSlots, studentHoles];
  return { placements: generated, objective, slots, unplaced, remaining: new Map(remaining) };
};

/** Interior free slots per day across `rows` (objective tier 2): for each day's used span, the
 *  count of periods strictly between the first and last used period that hold nothing. */
export const countInteriorHoles = (rows: { day: number; period: number }[], days: number): number => {
  let holes = 0;
  for (let d = 1; d <= days; d++) {
    const used = new Set(rows.filter((x) => x.day === d).map((x) => x.period));
    if (used.size === 0) continue;
    for (let p = Math.min(...used) + 1; p < Math.max(...used); p++) if (!used.has(p)) holes += 1;
  }
  return holes;
};

/** Week-aware per-student day holes (objective tier 4): (span − occupied) summed over
 *  student-day-week lanes. A `both`-week row expands to both concrete lanes. */
export const countStudentHoles = (
  courses: GroupingCourse[],
  rows: { courseId: string; day: number; period: number; week: PlacementWeek }[],
): number => {
  const byStudentDay = new Map<string, Set<number>>();
  const studentsOf = new Map(courses.map((c) => [c.id, c.studentKeys]));
  for (const row of rows) {
    const weeks = row.week === "both" ? ["a", "b"] : [row.week];
    for (const s of studentsOf.get(row.courseId) ?? []) {
      for (const w of weeks) {
        const k = `${s}|${row.day}|${w}`;
        const set = byStudentDay.get(k) ?? new Set<number>();
        if (!byStudentDay.has(k)) byStudentDay.set(k, set);
        set.add(row.period);
      }
    }
  }
  let total = 0;
  for (const periods of byStudentDay.values()) {
    if (periods.size === 0) continue;
    total += Math.max(...periods) - Math.min(...periods) + 1 - periods.size;
  }
  return total;
};
