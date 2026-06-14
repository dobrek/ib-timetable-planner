import { unwrapRow, type SupabaseClient } from "@/shared/api";
import type { UpdateMergeHoursInput } from "../model/schemas";
import { assertMergeParent } from "./assert-merge-parent";

/** Update a composite merge parent's authored weekly hours. Guarded to merge parents only. */
export const updateMergeHours = async (supabase: SupabaseClient, input: UpdateMergeHoursInput) => {
  await assertMergeParent(supabase, input.planId, input.parentCourseId);

  return unwrapRow(
    await supabase
      .from("courses")
      .update({ hours_per_week: input.hoursPerWeek })
      .eq("plan_id", input.planId)
      .eq("id", input.parentCourseId)
      .select()
      .single(),
    { notFound: "Merge parent not found.", failure: "Failed to update merge hours" },
  );
};
