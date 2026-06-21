/**
 * Pure data shapes for the cohort-catalog projection and its fingerprint. Moved here
 * from `plan-detail` so the plans hub's clone flow can recompute hashes without a
 * same-layer cross-slice import (steiger `forbidden-imports`). `plan-detail/model`
 * re-exports these so constraint-core signatures are unchanged.
 */

export type GroupingCourse = {
  id: string;
  teacherKeys: string[];
  studentKeys: string[];
  hours: number;
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
  /** course.id → reconstructed composite name (the fixture's natural key) for display + cross-check. */
  names: Map<string, string>;
  warnings: ComputeWarning[];
};
