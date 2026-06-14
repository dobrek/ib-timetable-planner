import { unwrapMany, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";

/**
 * Guard that an id is a real composite merge parent (it owns at least one `course_merges`
 * link) within the given plan. Used by dissolve/update-hours so those paths can never
 * touch a plain atomic course or another plan's rows.
 */
export const assertMergeParent = async (
  supabase: SupabaseClient,
  planId: string,
  parentCourseId: string,
): Promise<void> => {
  const rows = unwrapMany(
    await supabase
      .from("course_merges")
      .select("parent_course_id")
      .eq("plan_id", planId)
      .eq("parent_course_id", parentCourseId)
      .limit(1),
    "Merge lookup failed",
  );
  if (rows.length === 0) {
    throw new DomainError("NOT_FOUND", "Not a merge parent.");
  }
};
