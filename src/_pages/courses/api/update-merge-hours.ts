import type { SupabaseClient } from "@/shared/api";
import type { UpdateMergeHoursInput } from "../model/schemas";
import { DomainError } from "@/shared/lib/errors";
import { assertMergeParent } from "./assert-merge-parent";

/** Update a composite merge parent's authored weekly hours. Guarded to merge parents only. */
export const updateMergeHours = async (supabase: SupabaseClient, input: UpdateMergeHoursInput) => {
  await assertMergeParent(supabase, input.parentCourseId);

  const { data, error } = await supabase
    .from("courses")
    .update({ hours_per_week: input.hoursPerWeek })
    .eq("id", input.parentCourseId)
    .select()
    .single();
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to update merge hours: ${error.message}`);
  }
  return data;
};
