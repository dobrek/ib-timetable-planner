import { COHORT_VALUES } from "@/shared/config";
import type { GeneratorSnapshot } from "./types";

/**
 * The PINNED FLOOR of tier 5 (`softHits`) for a snapshot: how many soft-availability hits the
 * author's own pins already own, before the solver places anything.
 *
 * This is the TypeScript mirror of `soft_hits_terms`'s floor in
 * `services/solver/src/cpsat_engine/objective.py`, and it has to stay one. Clean mode constrains
 * `softHits == floor`, so this number is what tells the app whether a returned board honoured the
 * promise ("the solve added no NEW soft violations") or fell back — see `clean-label.ts`. Compute it
 * differently from the engine and the app will mislabel perfectly clean boards.
 *
 * The counting rule is the part that is easy to get wrong, so state it: **one hit per pin ROW per
 * soft CO-TEACHER**, never a set intersection of pins against soft cells. A co-taught pin whose cell
 * is soft for two of its teachers contributes 2, and two lane-disjoint pin rows sharing one soft cell
 * contribute 1 each — the tier dedups by neither teacher nor cell.
 *
 * Pins whose course is absent from the cohort catalog are skipped, exactly as `_Occupancy.register`
 * skips them: an unknown course has no teachers to be unavailable.
 */
export const computePinnedSoftFloor = (snapshot: GeneratorSnapshot): number => {
  const soft = softCellsByTeacher(snapshot);
  return COHORT_VALUES.reduce((total, cohort) => {
    const { courses, pins } = snapshot.cohorts[cohort];
    const teacherKeysByCourse = new Map(courses.map((course) => [course.id, course.teacherKeys]));
    return (
      total +
      pins.reduce((cohortTotal, pin) => {
        const teacherKeys = teacherKeysByCourse.get(pin.courseId) ?? [];
        return cohortTotal + teacherKeys.filter((key) => soft.get(key)?.has(cellKey(pin.day, pin.period))).length;
      }, 0)
    );
  }, 0);
};

const cellKey = (day: number, period: number): string => `${String(day)}:${String(period)}`;

const softCellsByTeacher = (snapshot: GeneratorSnapshot): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  for (const cell of snapshot.availability) {
    if (cell.severity !== "soft") continue;
    const cells = index.get(cell.teacherKey) ?? new Set<string>();
    cells.add(cellKey(cell.day, cell.period));
    index.set(cell.teacherKey, cells);
  }
  return index;
};
