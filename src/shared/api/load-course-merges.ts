import type { SupabaseClient } from "@/shared/api";
import { unwrapMany } from "./postgrest";

/** One parent→child merge relation of a plan's catalog. */
export type CourseMerge = { parentId: string; childId: string };

/**
 * One plan's `course_merges` relations. `loadCohortCourses` queries the same relation
 * internally to union rosters, but its `CohortCatalog` does not expose the mapping —
 * consumers that must resolve composites to their real children read it through this
 * fetcher instead.
 */
export const loadCourseMerges = async (supabase: SupabaseClient, planId: string): Promise<CourseMerge[]> => {
  const rows = unwrapMany(
    await supabase.from("course_merges").select("parent_course_id, child_course_id").eq("plan_id", planId).limit(2000),
    "Failed to load course merges",
  );
  return rows.map((row) => ({ parentId: row.parent_course_id, childId: row.child_course_id }));
};
