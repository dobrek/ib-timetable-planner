import { COHORTS, COHORT_VALUES, type Cohort } from "@/shared/config";
import type { TeacherOption } from "./course";

/**
 * Catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the cohort tab, teacher filter, and
 * hide-merged toggle. Pure projections — `filterCourses` does the actual filtering.
 */
export type CatalogFilters = {
  cohort: Cohort;
  teacherIds: string[];
  hideMerged: boolean;
};

/**
 * Parse catalog filters from a URL query string, dropping unknown cohort/teacher values so a
 * bookmarked or stale URL falls back to defaults instead of erroring. Defaults: first cohort,
 * no teacher filter, merged shown. `?cohort=dp1` carries the readable enum value.
 */
export const readFilterParams = (search: string, teachers: readonly TeacherOption[]): CatalogFilters => {
  const params = new URLSearchParams(search);
  const knownTeachers = new Set(teachers.map((teacher) => teacher.id));

  const requestedCohort = params.get("cohort");
  const cohort = (COHORT_VALUES as readonly string[]).includes(requestedCohort ?? "")
    ? (requestedCohort as Cohort)
    : COHORTS[0].value;

  const requestedTeachers = (params.get("teachers") ?? "").split(",").filter(Boolean);
  const teacherIds = requestedTeachers.filter((id) => knownTeachers.has(id));

  return { cohort, teacherIds, hideMerged: params.get("merged") === "hidden" };
};

/** Serialize catalog filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: CatalogFilters): string => {
  const params = new URLSearchParams();
  params.set("cohort", filters.cohort);
  if (filters.teacherIds.length > 0) params.set("teachers", filters.teacherIds.join(","));
  if (filters.hideMerged) params.set("merged", "hidden");
  return params.toString();
};
