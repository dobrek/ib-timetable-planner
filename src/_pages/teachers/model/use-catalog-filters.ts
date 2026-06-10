import { useEffect, useState } from "react";
import type { YearFilter } from "./filter-teachers";
import { readFilterParams, toFilterSearch } from "./filter-params";

export type TeacherFilterState = {
  query: string;
  setQuery: (value: string) => void;
  year: YearFilter;
  setYear: (value: YearFilter) => void;
};

/**
 * Owns teacher catalog filter state and URL sync. Filters start at SSR-safe defaults,
 * then seed from the URL on mount; until then we don't mirror back so the first render
 * can't clobber a bookmarked URL.
 */
export function useCatalogFilters(): TeacherFilterState {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState<YearFilter>("all");
  const [filtersReady, setFiltersReady] = useState(false);

  useEffect(() => {
    const filters = readFilterParams(window.location.search);
    /* eslint-disable react-hooks/set-state-in-effect -- client-only URL state, seeded after the SSR-matching first render */
    setQuery(filters.query);
    setYear(filters.year);
    setFiltersReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    const search = toFilterSearch({ query, year });
    const url = window.location.pathname + (search ? `?${search}` : "");
    window.history.replaceState(window.history.state, "", url);
  }, [filtersReady, query, year]);

  return { query, setQuery, year, setYear };
}
