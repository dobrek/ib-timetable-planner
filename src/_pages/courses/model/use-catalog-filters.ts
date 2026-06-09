import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { CohortTab, TeacherOption } from "./course";
import { readFilterParams, toFilterSearch } from "./filter-params";

export type CatalogFilterState = {
  activeCohortId: string;
  setActiveCohortId: (id: string) => void;
  selectedTeacherIds: string[];
  setSelectedTeacherIds: (ids: string[]) => void;
  hideMerged: boolean;
  setHideMerged: Dispatch<SetStateAction<boolean>>;
};

/**
 * Owns catalog filter state and URL sync. Filters start at SSR-safe defaults, then seed
 * from the URL on mount; until then we don't mirror back so the first render can't clobber
 * a bookmarked URL.
 */
export function useCatalogFilters(
  cohorts: readonly CohortTab[],
  teachers: readonly TeacherOption[],
): CatalogFilterState {
  const [activeCohortId, setActiveCohortId] = useState(cohorts[0]?.id ?? "");
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [hideMerged, setHideMerged] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false);

  useEffect(() => {
    const filters = readFilterParams(window.location.search, cohorts, teachers);
    /* eslint-disable react-hooks/set-state-in-effect -- client-only URL state, seeded after the SSR-matching first render */
    setActiveCohortId(filters.cohortId);
    setSelectedTeacherIds(filters.teacherIds);
    setHideMerged(filters.hideMerged);
    setFiltersReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [cohorts, teachers]);

  useEffect(() => {
    if (!filtersReady) return;
    const search = toFilterSearch({ cohortId: activeCohortId, teacherIds: selectedTeacherIds, hideMerged });
    const url = window.location.pathname + (search ? `?${search}` : "");
    window.history.replaceState(window.history.state, "", url);
  }, [filtersReady, activeCohortId, selectedTeacherIds, hideMerged]);

  return {
    activeCohortId,
    setActiveCohortId,
    selectedTeacherIds,
    setSelectedTeacherIds,
    hideMerged,
    setHideMerged,
  };
}
