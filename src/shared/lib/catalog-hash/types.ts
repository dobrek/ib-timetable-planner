/**
 * Pure data shapes for the cohort-catalog projection and its fingerprint. Moved here
 * from `plan-detail` so the plans hub's clone flow can recompute hashes without a
 * same-layer cross-slice import (steiger `forbidden-imports`). `entities/timetable`
 * re-exports these so constraint-core signatures are unchanged.
 */

import type { SubjectColor, WeekMode } from "@/shared/config";

/**
 * Per-course display data resolved at the render edge — the `name` (the fixture's natural key) plus
 * the optional author-chosen `color`. Kept off `GroupingCourse`/the catalog hash (display-only,
 * never a constraint input). Lives here next to `CohortCatalog`, which carries the map;
 * `entities/timetable/model/course-display.ts` re-exports it and owns the `resolveCourseDisplay` edge helper.
 */
export type CourseDisplay = { name: string; color: SubjectColor | null };

/**
 * Raw course identity — the cross-plan natural key `(cohort, name, level, group_index)`, minus the
 * cohort, which is implied by the `CohortCatalog` that carries it. `courseDisplay` folds the same
 * three columns into one composite token and throws the parts away; the plan-comparison fingerprint
 * and the analyzer's subject roll-ups need them separately.
 *
 * A side-set (never a `GroupingCourse` field), so `computeCatalogHash` — and with it grouping
 * staleness — is unaffected. Distinct from `bench/fixture-courses.ts`'s `CourseIdentity`, which is
 * the same concept at a different shape (it also carries the plan-local `id` and the `cohort`).
 */
export type CourseNaturalKey = { name: string; level: string; groupIndex: number };

export type GroupingCourse = {
  id: string;
  teacherKeys: string[];
  studentKeys: string[];
  hours: number;
  /** Fortnightly eligibility — drives opposite-week enumeration and the catalog hash. */
  weekMode: WeekMode;
};

export type ComputeWarning = {
  courseId: string;
  kind: "no-students" | "zero-hours";
  message: string;
};

/** The catalog fingerprint input that drives out-of-date detection. */
export type CatalogSnapshot = GroupingCourse[];

export type CohortCatalog = {
  courses: GroupingCourse[];
  /** course.id → display data (composite name + optional color), resolved at the render edge. */
  courseDisplay: Map<string, CourseDisplay>;
  /** course.id → the raw `(name, level, group_index)` triple, keyed over the same *projected* course
   *  set as `courses` (a merge parent's identity comes from its own row). A side-set, never a
   *  `GroupingCourse` field — the catalog hash is untouched. */
  courseIdentity: Map<string, CourseNaturalKey>;
  /** Ids of this cohort's courses flagged `finishes_early`. Delivered as a side-set (never a
   *  `GroupingCourse` field), so the catalog hash — and thus grouping staleness — is unaffected. */
  finishesEarlyCourseIds: string[];
  warnings: ComputeWarning[];
};
