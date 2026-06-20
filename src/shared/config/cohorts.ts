import { z } from "zod";
import type { Database } from "@/shared/api/database.types";

/**
 * The fixed two-cohort programme structure (the two IB DP cohorts, dp1 / dp2), single-sourced
 * from the generated `cohort` enum. Replaces the dropped `cohorts` table: the set is
 * declared-fixed, so it lives as config, not data. Order is display order (`dp1` < `dp2`).
 */

export type Cohort = Database["public"]["Enums"]["cohort"];

/** A cohort presented for tabs/selects: enum value + display label. */
export type CohortOption = { value: Cohort; label: string };

export const COHORT_VALUES = ["dp1", "dp2"] as const satisfies readonly Cohort[];

export const COHORTS: readonly CohortOption[] = [
  { value: "dp1", label: "DP1" },
  { value: "dp2", label: "DP2" },
];

/** Shared Zod field for cohort inputs — the authoritative gate mirrors the DB enum. */
export const cohortSchema = z.enum(COHORT_VALUES);

export const cohortLabel = (cohort: Cohort): string =>
  COHORTS.find((option) => option.value === cohort)?.label ?? cohort;
