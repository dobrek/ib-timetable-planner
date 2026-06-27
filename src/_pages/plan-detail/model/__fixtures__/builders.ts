/**
 * Shared unit-test fixture builders for the `plan-detail/model` constraint core.
 *
 * One home for the builders that the model test files (and the Risk #6 parity harness,
 * `collision-parity.test.ts`) consume, eliminating the per-file duplication and the two
 * incompatible inline `ctx` signatures. Every builder is a pure function over the app's
 * own domain types (`GroupingCourse` / `PlannerPlacement` / `BoardContext` /
 * `AvailabilityIndex`) — no bespoke fixture shapes (lessons.md "port the mechanism").
 *
 * `hours` is standardized to `4` and is inert for every constraint under test (the
 * collision rules read teacher/student/week only).
 */
import type { PlacementWeek } from "@/shared/config";
import type { AvailabilityIndex } from "../cross-cohort/availability-index";
import type { CellCollisions } from "../collision/collisions";
import type { BoardContext } from "../collision/constraints";
import type { CrossCohortIndex } from "../cross-cohort/cross-cohort-index";
import type { GroupingCourse } from "../grouping/grouping";
import type { PlannerPlacement } from "../placement/placement";

/** A single-teacher (or teacher-less, when `teacher === null`) course. `studentKeys` defaults `[]`. */
export const course = (id: string, teacher: string | null, studentKeys: string[] = []): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  studentKeys,
  hours: 4,
  weekMode: "agnostic",
});

/** A bi-weekly single-teacher course — eligible for the opposite-week (A/B) relaxation. */
export const biweekly = (id: string, teacher: string | null, studentKeys: string[] = []): GroupingCourse => ({
  ...course(id, teacher, studentKeys),
  weekMode: "biweekly",
});

/** A co-taught course carrying a teacher set. `studentKeys` defaults `[]`. */
export const coTaught = (id: string, teacherKeys: string[], studentKeys: string[] = []): GroupingCourse => ({
  id,
  teacherKeys,
  studentKeys,
  hours: 4,
  weekMode: "agnostic",
});

/** One placed course-hour. `week` defaults `both` (agnostic). */
export const placement = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
): PlannerPlacement => ({ id, courseId, day, period, week });

/** A validation catalog keyed by course id. */
export const catalog = (...courses: GroupingCourse[]): Map<string, GroupingCourse> =>
  new Map(courses.map((c) => [c.id, c]));

/** Board context at cell (1,1) over a catalog of `courses`; no week or availability data. */
export const cellCtx = (...courses: GroupingCourse[]): BoardContext => ({
  cell: { day: 1, period: 1 },
  catalogById: catalog(...courses),
});

/**
 * `cellCtx` plus per-course placement weeks (`courseId → week`). `undefined` weeks omits
 * `weekByCourseId` entirely (week-blind ⇒ every course reads as `both`).
 */
export const weekCtx = (weeks?: Record<string, PlacementWeek>, ...courses: GroupingCourse[]): BoardContext => ({
  ...cellCtx(...courses),
  ...(weeks ? { weekByCourseId: new Map(Object.entries(weeks)) } : {}),
});

/**
 * Board context carrying teacher-availability data (already as `Map`s). `cell` defaults
 * (1,1); `courses` default to an empty catalog (availability flags a single occupant).
 */
export const availCtx = (opts: {
  cell?: { day: number; period: number };
  strong?: Map<string, Set<string>>;
  soft?: Map<string, Set<string>>;
  courses?: GroupingCourse[];
}): BoardContext => ({
  cell: opts.cell ?? { day: 1, period: 1 },
  catalogById: catalog(...(opts.courses ?? [])),
  ...(opts.strong ? { strongUnavailableByTeacher: opts.strong } : {}),
  ...(opts.soft ? { softUnavailableByTeacher: opts.soft } : {}),
});

/**
 * An `AvailabilityIndex` for `deriveCellViolations`, built from `teacherKey → cellKey[]`
 * maps so harness rows stay literal rather than hand-rolling nested `Map`/`Set`.
 */
export const avail = (opts: {
  strong?: Record<string, string[]>;
  soft?: Record<string, string[]>;
}): AvailabilityIndex => ({
  strongUnavailableByTeacher: toCellSets(opts.strong),
  softUnavailableByTeacher: toCellSets(opts.soft),
});

/**
 * A `CrossCohortIndex` for `deriveCellViolations` / `deriveDropHints`, built from
 * `teacherKey → { cellKey → week[] }` so harness rows stay literal rather than hand-rolling the
 * nested `Map`/`Set`. Mirrors `avail` for the cross-cohort axis.
 */
export const occupiedBy = (byTeacher: Record<string, Record<string, PlacementWeek[]>>): CrossCohortIndex =>
  new Map(
    Object.entries(byTeacher).map(([teacher, cells]) => [
      teacher,
      new Map(Object.entries(cells).map(([cell, weeks]) => [cell, new Set(weeks)])),
    ]),
  );

/** Union of every course id cited across a cell's violations (the blocking ∪ warn invariant oracle). */
export const unionOfViolationCourseIds = (cell: CellCollisions): Set<string> => {
  const ids = new Set<string>();
  for (const violation of cell.violations) {
    if (violation.kind === "duplicate-course") ids.add(violation.courseId);
    else for (const id of violation.courseIds) ids.add(id);
  }
  return ids;
};

const toCellSets = (byTeacher: Record<string, string[]> | undefined): Map<string, Set<string>> =>
  new Map(Object.entries(byTeacher ?? {}).map(([teacher, cells]) => [teacher, new Set(cells)]));
