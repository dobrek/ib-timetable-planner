import type { SupabaseClient } from "@/shared/api";

export type AddMergeInput = {
  planId: string;
  parentCourseId: string;
  childCourseId: string;
};

/**
 * Insert one `course_merges` row (a "filet with cores": a parent virtual session
 * collapsing a child course). Direct input insert; both courses must already
 * exist in the plan.
 */
export async function addMerge(supabase: SupabaseClient, input: AddMergeInput): Promise<void> {
  const { planId, parentCourseId, childCourseId } = input;
  const { error } = await supabase
    .from("course_merges")
    .insert({ plan_id: planId, parent_course_id: parentCourseId, child_course_id: childCourseId });
  if (error) throw new Error(`addMerge: ${error.message}`);
}
