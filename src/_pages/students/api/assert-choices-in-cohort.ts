import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { CHOICES_NOT_IN_COHORT_MESSAGE } from "./constants";

/**
 * Authoritative server-side cohort gate. The client scopes the picker to the selected cohort,
 * but a stale or crafted call could attach cross-cohort (or non-existent) choices that S-06's
 * grouping would choke on. Every submitted course id must exist AND belong to `cohortId`.
 * No-op for the empty set.
 */
export const assertChoicesInCohort = async (
  supabase: SupabaseClient,
  cohortId: string,
  courseIds: readonly string[],
): Promise<void> => {
  if (courseIds.length === 0) return;

  const { data, error } = await supabase.from("courses").select("id, cohort_id").in("id", courseIds);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Choice lookup failed: ${error.message}`);
  }

  const inCohort = new Set(data.filter((course) => course.cohort_id === cohortId).map((course) => course.id));
  if (courseIds.some((id) => !inCohort.has(id))) {
    throw new DomainError("BAD_REQUEST", CHOICES_NOT_IN_COHORT_MESSAGE);
  }
};
