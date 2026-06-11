import { useCallback } from "react";
import type { CohortOption } from "@/shared/api";
import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import { readFilterParams, toFilterSearch, type StudentFilters } from "./filter-params";

export type StudentFilterState = {
  activeCohortId: string;
  setActiveCohortId: (id: string) => void;
  query: string;
  setQuery: (query: string) => void;
};

/** Owns student catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(cohorts: readonly CohortOption[]): StudentFilterState {
  const parse = useCallback((search: string): StudentFilters => readFilterParams(search, cohorts), [cohorts]);
  const { state, setState } = useUrlSyncedFilters({ cohortId: cohorts[0]?.id ?? "", query: "" }, parse, toFilterSearch);

  return {
    activeCohortId: state.cohortId,
    setActiveCohortId: (id) => {
      setState((current) => ({ ...current, cohortId: id }));
    },
    query: state.query,
    setQuery: (query) => {
      setState((current) => ({ ...current, query }));
    },
  };
}
