import type { LoadedPlan } from "../api/load-plan-analysis";
import {
  availabilityKey,
  courseKey,
  projectAvailabilityCells,
  projectChoices,
  projectCourses,
  studentNames,
  teacherCodes,
  type ProjectedCourse,
} from "./catalog-fingerprint";

/**
 * *What* drifted, not merely *that* something did.
 *
 * The banner is the sole guard against misreading a drifted comparison (v1 renders every row and lets
 * the expert judge), so it has to name the damage. A boolean tells the reader something is wrong but
 * not whether it is one renamed course — harmless — or a different student body, which invalidates
 * half the scoreboard. With render-everything-and-let-the-expert-judge, that distinction IS the
 * product.
 *
 * Pure and synchronous: the fingerprint is the fast path, and this runs only when fingerprints differ.
 * It folds over exactly the projections the fingerprint hashes, so the two can never disagree about
 * what "the catalog" is.
 */
export const diffCatalogs = (baseline: LoadedPlan, other: LoadedPlan): CatalogDiff => ({
  courses: diffEntries(courseEntries(baseline), courseEntries(other)),
  teachers: diffEntries(identityEntries(teacherCodes(baseline)), identityEntries(teacherCodes(other))),
  students: diffEntries(identityEntries(studentNames(baseline)), identityEntries(studentNames(other))),
  choices: diffEntries(identityEntries(projectChoices(baseline)), identityEntries(projectChoices(other))),
  availability: diffEntries(availabilityEntries(baseline), availabilityEntries(other)),
  grid: diffGrid(baseline, other),
});

export type CatalogDiff = {
  courses: SetDiff;
  teachers: SetDiff;
  students: SetDiff;
  choices: SetDiff;
  availability: SetDiff;
  grid: GridDiff;
};

/**
 * `added`/`removed` count entries whose *identity* appears on only one side; `changed` counts entries
 * present on both whose *value* differs (a course keeping its natural key but changing hours; an
 * availability cell going soft → strong). Kept separate because they mean different things to a
 * reader: a changed course still exists, a removed one does not.
 */
export type SetDiff = { added: number; removed: number; changed: number };

export type GridDiff = {
  equal: boolean;
  baseline: GridShape;
  other: GridShape;
};

export type GridShape = { days: number; periods: number };

/** True when nothing in any category moved — the diff's own "clean" predicate. */
export const isCleanDiff = (diff: CatalogDiff): boolean =>
  diff.grid.equal && CATEGORIES.every((category) => isEmpty(diff[category]));

/**
 * The zero diff, for the fingerprint's fast path: equal digests mean equal catalogs, so there is
 * nothing to diff and the fold is skipped entirely. The grid shapes are still carried, because the
 * banner renders them even when they agree.
 */
export const cleanDiff = (baseline: LoadedPlan, other: LoadedPlan): CatalogDiff => ({
  courses: NOTHING_MOVED,
  teachers: NOTHING_MOVED,
  students: NOTHING_MOVED,
  choices: NOTHING_MOVED,
  availability: NOTHING_MOVED,
  grid: diffGrid(baseline, other),
});

const NOTHING_MOVED: SetDiff = { added: 0, removed: 0, changed: 0 };

export const CATEGORIES = ["courses", "teachers", "students", "choices", "availability"] as const;

export type DiffCategory = (typeof CATEGORIES)[number];

const isEmpty = (diff: SetDiff): boolean => diff.added === 0 && diff.removed === 0 && diff.changed === 0;

/** One comparable thing: an identity that decides existence, and a value that decides sameness. */
type Entry = { key: string; value: string };

/**
 * Multiset diff, not set diff. Student `full_name` carries no unique constraint, so two same-named
 * students are two students — collapsing them into one would under-report a real difference. Counting
 * occurrences per key keeps duplicates honest, and it matches the fingerprint, which hashes sorted
 * multisets rather than sets.
 */
const diffEntries = (baseline: Entry[], other: Entry[]): SetDiff => {
  const left = groupValues(baseline);
  const right = groupValues(other);
  const keys = new Set([...left.keys(), ...right.keys()]);

  return [...keys].reduce<SetDiff>(
    (diff, key) => {
      const before = left.get(key) ?? [];
      const after = right.get(key) ?? [];
      const shared = Math.min(before.length, after.length);
      // Values are sorted, so position i on each side describes the same occurrence of this key.
      const changed = before.slice(0, shared).filter((value, index) => value !== after[index]).length;
      return {
        added: diff.added + Math.max(0, after.length - before.length),
        removed: diff.removed + Math.max(0, before.length - after.length),
        changed: diff.changed + changed,
      };
    },
    { added: 0, removed: 0, changed: 0 },
  );
};

const groupValues = (entries: Entry[]): Map<string, string[]> => {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) grouped.set(entry.key, [...(grouped.get(entry.key) ?? []), entry.value]);
  for (const [key, values] of grouped) grouped.set(key, [...values].sort());
  return grouped;
};

/** A course keeps its identity `(cohort, name, level, group_index)` across a rename of nothing else;
 *  what can *change* under a stable identity is what it asks of the timetable. */
const courseEntries = (plan: LoadedPlan): Entry[] =>
  projectCourses(plan).map((course) => ({ key: courseKey(course), value: courseValue(course) }));

const courseValue = (course: ProjectedCourse): string => `${course.hours}h ${course.weekMode}`;

/** An availability cell is identified by (teacher, day, period); its severity is what can change —
 *  a soft `no` hardening to a strong one is a real difference, and it keeps the same identity. */
const availabilityEntries = (plan: LoadedPlan): Entry[] =>
  projectAvailabilityCells(plan).map((cell) => ({ key: availabilityKey(cell), value: cell.severity }));

/** Categories with no value dimension — presence is the whole story, so `changed` is always 0. */
const identityEntries = (tokens: string[]): Entry[] => tokens.map((token) => ({ key: token, value: "" }));

const diffGrid = (baseline: LoadedPlan, other: LoadedPlan): GridDiff => {
  const left = gridOf(baseline);
  const right = gridOf(other);
  return { equal: left.days === right.days && left.periods === right.periods, baseline: left, other: right };
};

const gridOf = (plan: LoadedPlan): GridShape => ({ days: plan.input.days, periods: plan.input.periods });
