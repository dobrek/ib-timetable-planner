import type { DissolveMergeInput } from "../schemas/course";
import { DomainError } from "../errors";
import { assertMergeParent } from "./assertMergeParent";
import type { Supabase } from "./shared";

/**
 * Dissolve a merge: delete the composite parent course; its `course_merges` links cascade
 * via FK (`on delete cascade`). The atomic children are untouched. Guarded so it can only
 * ever delete a real merge parent.
 */
export const dissolveMerge = async (supabase: Supabase, input: DissolveMergeInput) => {
  await assertMergeParent(supabase, input.parentCourseId);

  const { error } = await supabase.from("courses").delete().eq("id", input.parentCourseId);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to dissolve merge: ${error.message}`);
  }
  return { ok: true as const };
};
