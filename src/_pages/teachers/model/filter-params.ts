import type { YearFilter } from "./filter-teachers";

/**
 * Teacher catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the text search and year toggle.
 * Pure projections — `filterTeachers` does the actual filtering.
 */
export type TeacherFilters = {
  query: string;
  year: YearFilter;
};

const VALID_YEARS = new Set<YearFilter>(["all", "y1", "y2"]);

/** Parse teacher filters from a URL query string. Defaults: empty query, year "all". */
export const readFilterParams = (search: string): TeacherFilters => {
  const params = new URLSearchParams(search);
  const requestedYear = params.get("year");
  const year = requestedYear && VALID_YEARS.has(requestedYear as YearFilter) ? (requestedYear as YearFilter) : "all";

  return {
    query: params.get("q") ?? "",
    year,
  };
};

/** Serialize teacher filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: TeacherFilters): string => {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.year !== "all") params.set("year", filters.year);
  return params.toString();
};
