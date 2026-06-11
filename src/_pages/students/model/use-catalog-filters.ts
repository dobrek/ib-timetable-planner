import { useCallback } from "react";
import type { CohortOption } from "@/shared/api";
import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import { readFilterParams, toFilterSearch, type StudentFilters } from "./filter-params";
import type { CourseOption } from "./student";

export type StudentFilterState = {
  activeCohortId: string;
  setActiveCohortId: (id: string) => void;
  query: string;
  setQuery: (query: string) => void;
  selectedCourseIds: string[];
  setSelectedCourseIds: (ids: string[]) => void;
};

/** Owns student catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(
  cohorts: readonly CohortOption[],
  courses: readonly CourseOption[],
): StudentFilterState {
  const parse = useCallback(
    (search: string): StudentFilters => readFilterParams(search, cohorts, courses),
    [cohorts, courses],
  );
  const { state, setState } = useUrlSyncedFilters(
    { cohortId: cohorts[0]?.id ?? "", query: "", courseIds: [] },
    parse,
    toFilterSearch,
  );

  return {
    activeCohortId: state.cohortId,
    setActiveCohortId: (id) => {
      // Clear the course filter on a tab switch — a stale other-cohort selection would
      // silently empty the new tab (its courses can't intersect the previous cohort's).
      setState((current) => ({ ...current, cohortId: id, courseIds: [] }));
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
