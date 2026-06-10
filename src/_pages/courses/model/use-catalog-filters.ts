import { useCallback } from "react";
import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import type { CohortTab, TeacherOption } from "./course";
import { readFilterParams, toFilterSearch, type CatalogFilters } from "./filter-params";

export type CatalogFilterState = {
  activeCohortId: string;
  setActiveCohortId: (id: string) => void;
  selectedTeacherIds: string[];
  setSelectedTeacherIds: (ids: string[]) => void;
  hideMerged: boolean;
  setHideMerged: (value: boolean) => void;
};

/** Owns catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(
  cohorts: readonly CohortTab[],
  teachers: readonly TeacherOption[],
): CatalogFilterState {
  const parse = useCallback(
    (search: string): CatalogFilters => readFilterParams(search, cohorts, teachers),
    [cohorts, teachers],
  );
  const { state, setState } = useUrlSyncedFilters(
    { cohortId: cohorts[0]?.id ?? "", teacherIds: [], hideMerged: false },
    parse,
    toFilterSearch,
  );

  return {
    activeCohortId: state.cohortId,
    setActiveCohortId: (id) => {
      setState((current) => ({ ...current, cohortId: id }));
    },
    selectedTeacherIds: state.teacherIds,
    setSelectedTeacherIds: (ids) => {
      setState((current) => ({ ...current, teacherIds: ids }));
    },
    hideMerged: state.hideMerged,
    setHideMerged: (value) => {
      setState((current) => ({ ...current, hideMerged: value }));
    },
  };
}
