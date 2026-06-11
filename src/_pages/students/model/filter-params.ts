import type { CohortOption } from "@/shared/api";

/**
 * Student catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the cohort tab and name search. Pure
 * projections — `filterStudents` does the actual filtering. (`courseIds` joins in Phase 3.)
 */
export type StudentFilters = {
  cohortId: string;
  query: string;
};

/**
 * Parse student filters from a URL query string, dropping an unknown cohort id so a
 * bookmarked or stale URL falls back to the first cohort. Defaults: first cohort, empty query.
 */
export const readFilterParams = (search: string, cohorts: readonly CohortOption[]): StudentFilters => {
  const params = new URLSearchParams(search);
  const knownCohorts = new Set(cohorts.map((cohort) => cohort.id));

  const requestedCohort = params.get("cohort");
  const cohortId = requestedCohort && knownCohorts.has(requestedCohort) ? requestedCohort : (cohorts[0]?.id ?? "");

  return { cohortId, query: params.get("q") ?? "" };
};

/** Serialize student filters to a URL query string, omitting the empty query so clean state → clean URL. */
export const toFilterSearch = (filters: StudentFilters): string => {
  const params = new URLSearchParams();
  if (filters.cohortId) params.set("cohort", filters.cohortId);
  if (filters.query) params.set("q", filters.query);
  return params.toString();
};
