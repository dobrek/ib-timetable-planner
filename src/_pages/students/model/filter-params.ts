import { COHORTS, COHORT_VALUES, type Cohort } from "@/shared/config";
import type { CourseOption } from "./student";

/**
 * Student catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the cohort tab, name search, and course filter.
 * Pure projections — `filterStudents` does the actual filtering.
 */
export type StudentFilters = {
  cohort: Cohort;
  query: string;
  courseIds: string[];
};

/**
 * Parse student filters from a URL query string, dropping unknown cohort values and course ids
 * outside the resolved cohort so a bookmarked or stale URL falls back to defaults instead of
 * erroring. Defaults: first cohort, empty query, no course filter. `?cohort=dp1` carries the
 * readable enum value.
 */
export const readFilterParams = (search: string, courses: readonly CourseOption[]): StudentFilters => {
  const params = new URLSearchParams(search);

  const requestedCohort = params.get("cohort");
  const cohort = (COHORT_VALUES as readonly string[]).includes(requestedCohort ?? "")
    ? (requestedCohort as Cohort)
    : COHORTS[0].value;

  // Scope to the resolved cohort: an other-cohort id would empty the visible tab while
  // rendering no removable chip in the course filter.
  const cohortCourses = new Set(courses.filter((course) => course.cohort === cohort).map((course) => course.id));
  const requestedCourses = (params.get("courses") ?? "").split(",").filter(Boolean);
  const courseIds = requestedCourses.filter((id) => cohortCourses.has(id));

  return { cohort, query: params.get("q") ?? "", courseIds };
};

/** Serialize student filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: StudentFilters): string => {
  const params = new URLSearchParams();
  params.set("cohort", filters.cohort);
  if (filters.query) params.set("q", filters.query);
  if (filters.courseIds.length > 0) params.set("courses", filters.courseIds.join(","));
  return params.toString();
};
