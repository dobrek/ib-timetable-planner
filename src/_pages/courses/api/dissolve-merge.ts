import type { SupabaseClient } from "@/shared/api";
import { unwrapCompleted } from "@/shared/lib/postgrest";
import type { DissolveMergeInput } from "../model/schemas";
import { assertMergeParent } from "./assert-merge-parent";

/**
 * Dissolve a merge: delete the composite parent course; its `course_merges` links cascade
 * via FK (`on delete cascade`). The atomic children are untouched. Guarded so it can only
 * ever delete a real merge parent.
 */
export const dissolveMerge = async (supabase: SupabaseClient, input: DissolveMergeInput) => {
  await assertMergeParent(supabase, input.parentCourseId);

  return unwrapCompleted(
    await supabase.from("courses").delete().eq("id", input.parentCourseId),
    "Failed to dissolve merge",
  );
};
