import type { SupabaseClient } from "@/shared/api";
import { unwrapMany } from "./postgrest";

/** One teacher of a plan — identity, `code` (the filename slug component), and optional display name. */
export type PlanTeacher = { id: string; code: string; fullName: string | null };

/**
 * A plan's teachers with codes, ordered by full name (nulls last) then code — the shared enumeration
 * behind both the teacher-view switcher and the board's batch export. Hoisted out of the teacher-view
 * slice so plan-detail can reuse it without a cross-`_pages` import (mirrors `loadCourseMerges`), keeping
 * the query byte-for-byte: `id, code, full_name`, `eq plan_id`, `.limit(500)`, unwrapped via `unwrapMany`.
 */
export const loadPlanTeachers = async (supabase: SupabaseClient, planId: string): Promise<PlanTeacher[]> => {
  const rows = unwrapMany(
    await supabase
      .from("teachers")
      .select("id, code, full_name")
      .eq("plan_id", planId)
      .order("full_name", { nullsFirst: false })
      .order("code")
      .limit(500),
    "Failed to load the plan's teachers",
  );
  return rows.map((row) => ({ id: row.id, code: row.code, fullName: row.full_name }));
};
