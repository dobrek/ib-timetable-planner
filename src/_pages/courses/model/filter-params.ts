import type { CohortTab } from "./course";
import type { TeacherOption } from "@/entities/teacher";

/**
 * Catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the cohort tab, teacher filter, and
 * hide-merged toggle. Pure projections — `filterCourses` does the actual filtering.
 */
export type CatalogFilters = {
  cohortId: string;
  teacherIds: string[];
  hideMerged: boolean;
};

/**
 * Parse catalog filters from a URL query string, dropping unknown cohort/teacher ids so a
 * bookmarked or stale URL falls back to defaults instead of erroring. Defaults: first cohort,
 * no teacher filter, merged shown.
 */
export const readFilterParams = (
  search: string,
  cohorts: readonly CohortTab[],
  teachers: readonly TeacherOption[],
): CatalogFilters => {
  const params = new URLSearchParams(search);
  const knownCohorts = new Set(cohorts.map((cohort) => cohort.id));
  const knownTeachers = new Set(teachers.map((teacher) => teacher.id));

  const requestedCohort = params.get("cohort");
  const cohortId = requestedCohort && knownCohorts.has(requestedCohort) ? requestedCohort : (cohorts[0]?.id ?? "");

  const requestedTeachers = (params.get("teachers") ?? "").split(",").filter(Boolean);
  const teacherIds = requestedTeachers.filter((id) => knownTeachers.has(id));

  return { cohortId, teacherIds, hideMerged: params.get("merged") === "hidden" };
};

/** Serialize catalog filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: CatalogFilters): string => {
  const params = new URLSearchParams();
  if (filters.cohortId) params.set("cohort", filters.cohortId);
  if (filters.teacherIds.length > 0) params.set("teachers", filters.teacherIds.join(","));
  if (filters.hideMerged) params.set("merged", "hidden");
  return params.toString();
};
