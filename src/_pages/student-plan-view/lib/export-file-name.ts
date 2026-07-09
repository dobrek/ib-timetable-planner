import type { Cohort } from "@/shared/config";
import { slugify } from "@/shared/lib/slugify";

/**
 * Deterministic, filesystem-safe download name for a student's exported timetable:
 * `<plan-slug>-<cohort>-<student-slug>.xlsx`. The plan name and full name are slugified
 * (lowercased, diacritics folded, non-alphanumerics collapsed to `-`); `cohort` is a
 * `Cohort` literal (`dp1`/`dp2`) — already slug-safe — so it is interpolated directly.
 * Example: `"IB 2027 draft"` + `dp1` + `"Paweł Głąb"` → `ib-2027-draft-dp1-pawel-glab.xlsx`.
 */
export const studentExportFileName = (planName: string, cohort: Cohort, fullName: string): string =>
  `${slugify(planName)}-${cohort}-${slugify(fullName)}.xlsx`;
