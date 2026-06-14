import { unwrapCompleted, type SupabaseClient } from "@/shared/api";
import type { DissolveMergeInput } from "../model/schemas";
import { assertMergeParent } from "./assert-merge-parent";

/**
 * Dissolve a merge: delete the composite parent course; its `course_merges` links cascade
 * via FK (`on delete cascade`). The atomic children are untouched. Guarded so it can only
 * ever delete a real merge parent within the plan.
 */
export const dissolveMerge = async (supabase: SupabaseClient, input: DissolveMergeInput): Promise<void> => {
  await assertMergeParent(supabase, input.planId, input.parentCourseId);

  unwrapCompleted(
    await supabase.from("courses").delete().eq("plan_id", input.planId).eq("id", input.parentCourseId),
    "Failed to dissolve merge",
  );
};
