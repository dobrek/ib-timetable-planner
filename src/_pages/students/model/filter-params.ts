import type { CohortOption } from "@/shared/api";
import type { CourseOption } from "./student";

/**
 * Student catalog filter state mirrored into the URL query so a post-mutation
 * `navigate(pathname + search)` preserves the cohort tab, name search, and course filter.
 * Pure projections — `filterStudents` does the actual filtering.
 */
export type StudentFilters = {
  cohortId: string;
  query: string;
  courseIds: string[];
};

/**
 * Parse student filters from a URL query string, dropping unknown cohort/course ids so a
 * bookmarked or stale URL falls back to defaults instead of erroring. Defaults: first cohort,
 * empty query, no course filter.
 */
export const readFilterParams = (
  search: string,
  cohorts: readonly CohortOption[],
  courses: readonly CourseOption[],
): StudentFilters => {
  const params = new URLSearchParams(search);
  const knownCohorts = new Set(cohorts.map((cohort) => cohort.id));
  const knownCourses = new Set(courses.map((course) => course.id));

  const requestedCohort = params.get("cohort");
  const cohortId = requestedCohort && knownCohorts.has(requestedCohort) ? requestedCohort : (cohorts[0]?.id ?? "");

  const requestedCourses = (params.get("courses") ?? "").split(",").filter(Boolean);
  const courseIds = requestedCourses.filter((id) => knownCourses.has(id));

  return { cohortId, query: params.get("q") ?? "", courseIds };
};

/** Serialize student filters to a URL query string, omitting defaults so clean state → clean URL. */
export const toFilterSearch = (filters: StudentFilters): string => {
  const params = new URLSearchParams();
  if (filters.cohortId) params.set("cohort", filters.cohortId);
  if (filters.query) params.set("q", filters.query);
  if (filters.courseIds.length > 0) params.set("courses", filters.courseIds.join(","));
  return params.toString();
};
