import type { SupabaseClient } from "@/shared/api";
import type { DissolveMergeInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";
import { assertMergeParent } from "./assert-merge-parent";

/**
 * Dissolve a merge: delete the composite parent course; its `course_merges` links cascade
 * via FK (`on delete cascade`). The atomic children are untouched. Guarded so it can only
 * ever delete a real merge parent.
 */
export const dissolveMerge = async (supabase: SupabaseClient, input: DissolveMergeInput) => {
  await assertMergeParent(supabase, input.parentCourseId);

  const { error } = await supabase.from("courses").delete().eq("id", input.parentCourseId);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to dissolve merge: ${error.message}`);
  }
  return { ok: true as const };
};
