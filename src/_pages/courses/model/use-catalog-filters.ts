import { useCallback } from "react";
import { COHORTS, type Cohort } from "@/shared/config";
import { useUrlSyncedFilters } from "@/shared/lib/use-url-synced-filters";
import type { TeacherOption } from "./course";
import { readFilterParams, toFilterSearch, type CatalogFilters } from "./filter-params";

export type CatalogFilterState = {
  activeCohort: Cohort;
  setActiveCohort: (cohort: Cohort) => void;
  selectedTeacherIds: string[];
  setSelectedTeacherIds: (ids: string[]) => void;
  hideMerged: boolean;
  setHideMerged: (value: boolean) => void;
};

/** Owns catalog filter state; URL seeding/mirroring lives in the shared hook. */
export function useCatalogFilters(teachers: readonly TeacherOption[]): CatalogFilterState {
  const parse = useCallback((search: string): CatalogFilters => readFilterParams(search, teachers), [teachers]);
  const { state, setState } = useUrlSyncedFilters(
    { cohort: COHORTS[0].value, teacherIds: [], hideMerged: false },
    parse,
    toFilterSearch,
  );

  return {
    activeCohort: state.cohort,
    setActiveCohort: (cohort) => {
      setState((current) => ({ ...current, cohort }));
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
