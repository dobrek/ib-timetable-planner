import { useCallback } from "react";
import { COHORTS, type Cohort } from "@/shared/config";
import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import { readFilterParams, toFilterSearch, type StudentFilters } from "./filter-params";
import type { CourseOption } from "./student";

export type StudentFilterState = {
  activeCohort: Cohort;
  setActiveCohort: (cohort: Cohort) => void;
  query: string;
  setQuery: (query: string) => void;
  selectedCourseIds: string[];
  setSelectedCourseIds: (ids: string[]) => void;
};

/** Owns student catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(courses: readonly CourseOption[]): StudentFilterState {
  const parse = useCallback((search: string): StudentFilters => readFilterParams(search, courses), [courses]);
  const { state, setState } = useUrlSyncedFilters(
    { cohort: COHORTS[0].value, query: "", courseIds: [] },
    parse,
    toFilterSearch,
  );

  return {
    activeCohort: state.cohort,
    setActiveCohort: (cohort) => {
      // Clear the course filter on a tab switch — a stale other-cohort selection would
      // silently empty the new tab (its courses can't intersect the previous cohort's).
      setState((current) => ({ ...current, cohort, courseIds: [] }));
    },
    query: state.query,
    setQuery: (query) => {
      setState((current) => ({ ...current, query }));
    },
    selectedCourseIds: state.courseIds,
    setSelectedCourseIds: (ids) => {
      setState((current) => ({ ...current, courseIds: ids }));
    },
  };
}
