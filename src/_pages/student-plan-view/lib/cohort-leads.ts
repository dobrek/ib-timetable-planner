import type { Cohort } from "@/shared/config";
import type { StudentSummary } from "../api/loader";

/**
 * Resolves, per cohort, the student that cohort's tab should navigate to — the first in the
 * loader's name-ordered list, or `undefined` when the cohort has no students (→ its tab is
 * disabled). Preserves input order: it never re-sorts, mirroring how the switcher's dropdown
 * already trusts the loader's `order("full_name")`. The `Record<Cohort, …>` return keeps the
 * fixed two-cohort set exhaustive — adding a cohort would fail the type-check here.
 */
export const cohortLeads = (students: StudentSummary[]): Record<Cohort, StudentSummary | undefined> => ({
  dp1: students.find((student) => student.cohort === "dp1"),
  dp2: students.find((student) => student.cohort === "dp2"),
});
