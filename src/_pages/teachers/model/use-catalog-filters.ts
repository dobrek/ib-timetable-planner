import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import type { CohortFilter } from "./filter-teachers";
import { readFilterParams, toFilterSearch } from "./filter-params";

export type TeacherFilterState = {
  query: string;
  setQuery: (value: string) => void;
  cohort: CohortFilter;
  setCohort: (value: CohortFilter) => void;
};

/** Owns teacher catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(): TeacherFilterState {
  const { state, setState } = useUrlSyncedFilters({ query: "", cohort: "all" }, readFilterParams, toFilterSearch);

  return {
    query: state.query,
    setQuery: (value) => {
      setState((current) => ({ ...current, query: value }));
    },
    cohort: state.cohort,
    setCohort: (value) => {
      setState((current) => ({ ...current, cohort: value }));
    },
  };
}
