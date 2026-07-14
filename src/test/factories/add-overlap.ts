import type { SupabaseClient } from "@/shared/api";

export type AddOverlapInput = {
  planId: string;
  baseCourseId: string;
  dependentCourseId: string;
};

/**
 * Insert one `course_overlaps` row: the base and its dependent are taught as ONE combined session,
 * so the base carries the session's hours and receives the dependent's students. Direct input
 * insert; both courses must already exist in the plan and share its cohort.
 */
export async function addOverlap(supabase: SupabaseClient, input: AddOverlapInput): Promise<void> {
  const { error } = await supabase.from("course_overlaps").insert({
    plan_id: input.planId,
    base_course_id: input.baseCourseId,
    dependent_course_id: input.dependentCourseId,
  });
  if (error) throw new Error(`addOverlap: ${error.message}`);
}
