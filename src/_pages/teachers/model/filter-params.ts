import { COHORT_VALUES } from "@/shared/config";
import type { CohortFilter } from "./filter-teachers";

/**
 * Teacher catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the text search and cohort toggle.
 * Pure projections — `filterTeachers` does the actual filtering.
 */
export type TeacherFilters = {
  query: string;
  cohort: CohortFilter;
};

const VALID_COHORTS = new Set<CohortFilter>(["all", ...COHORT_VALUES]);

/** Parse teacher filters from a URL query string. Defaults: empty query, cohort "all". */
export const readFilterParams = (search: string): TeacherFilters => {
  const params = new URLSearchParams(search);
  const requestedCohort = params.get("cohort");
  const cohort =
    requestedCohort && VALID_COHORTS.has(requestedCohort as CohortFilter) ? (requestedCohort as CohortFilter) : "all";

  return {
    query: params.get("q") ?? "",
    cohort,
  };
};

/** Serialize teacher filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: TeacherFilters): string => {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.cohort !== "all") params.set("cohort", filters.cohort);
  return params.toString();
};
