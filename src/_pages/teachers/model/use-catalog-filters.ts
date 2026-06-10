import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import type { YearFilter } from "./filter-teachers";
import { readFilterParams, toFilterSearch } from "./filter-params";

export type TeacherFilterState = {
  query: string;
  setQuery: (value: string) => void;
  year: YearFilter;
  setYear: (value: YearFilter) => void;
};

/** Owns teacher catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(): TeacherFilterState {
  const { state, setState } = useUrlSyncedFilters({ query: "", year: "all" }, readFilterParams, toFilterSearch);

  return {
    query: state.query,
    setQuery: (value) => {
      setState((current) => ({ ...current, query: value }));
    },
    year: state.year,
    setYear: (value) => {
      setState((current) => ({ ...current, year: value }));
    },
  };
}
