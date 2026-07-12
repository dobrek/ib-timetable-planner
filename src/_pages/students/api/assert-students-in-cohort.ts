import { unwrapMany, type SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import { STUDENTS_NOT_IN_COHORT_MESSAGE } from "./constants";

/**
 * Authoritative server-side gate for a bulk edit's target students — the selected-students
 * twin of assertChoicesInCohort. The client binds selection to the active cohort tab, but a
 * stale or crafted call could list other-cohort or other-plan students; every submitted id
 * must exist in the plan AND match the cohort (the composite FKs backstop the plan pin).
 * The schema enforces a non-empty set, so the early return is only for symmetry.
 */
export const assertStudentsInCohort = async (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
  studentIds: readonly string[],
): Promise<void> => {
  if (studentIds.length === 0) return;

  const rows = unwrapMany(
    await supabase.from("students").select("id, cohort").eq("plan_id", planId).in("id", studentIds),
    "Student lookup failed",
  );

  const inCohort = new Set(rows.filter((student) => student.cohort === cohort).map((student) => student.id));
  if (studentIds.some((id) => !inCohort.has(id))) {
    throw new DomainError("BAD_REQUEST", STUDENTS_NOT_IN_COHORT_MESSAGE);
  }
};
