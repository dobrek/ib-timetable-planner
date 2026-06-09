import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";

/**
 * Guard that an id is a real composite merge parent (it owns at least one `course_merges`
 * link). Used by dissolve/update-hours so those paths can never touch a plain atomic course.
 */
export const assertMergeParent = async (supabase: SupabaseClient, parentCourseId: string): Promise<void> => {
  const { data, error } = await supabase
    .from("course_merges")
    .select("parent_course_id")
    .eq("parent_course_id", parentCourseId)
    .limit(1);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Merge lookup failed: ${error.message}`);
  }
  if (data.length === 0) {
    throw new DomainError("NOT_FOUND", "Not a merge parent.");
  }
};
