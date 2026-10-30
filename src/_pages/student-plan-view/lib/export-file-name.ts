import type { Cohort } from "@/shared/config";
import { planFileStem, slugify } from "@/shared/lib/slugify";

/**
 * Deterministic, filesystem-safe download name for a student's exported timetable:
 * `<plan-stem>-<cohort>-<student-slug>.xlsx`. The plan stem is `planFileStem` (the plan slug, plus
 * `-current` while the plan is the current one) and the full name is slugified (lowercased,
 * diacritics folded, non-alphanumerics collapsed to `-`); `cohort` is a `Cohort` literal
 * (`dp1`/`dp2`) — already slug-safe — so it is interpolated directly.
 * Example: `"IB 2027 draft"` + `dp1` + `"Paweł Głąb"` → `ib-2027-draft-dp1-pawel-glab.xlsx`.
 */
export const studentExportFileName = (planName: string, isCurrent: boolean, cohort: Cohort, fullName: string): string =>
  `${planFileStem(planName, isCurrent)}-${cohort}-${slugify(fullName)}.xlsx`;
