import type { SupabaseClient } from "@/shared/api";

export type AddTeacherInput = {
  planId: string;
  code: string;
  fullName?: string;
};

/**
 * Insert one `teachers` row and return its id — the minimum a course needs to satisfy the
 * app's ≥1-teacher invariant when a suite builds its own topology instead of seeding the
 * whole CSV catalog.
 */
export async function addTeacher(supabase: SupabaseClient, input: AddTeacherInput): Promise<{ teacherId: string }> {
  const { data, error } = await supabase
    .from("teachers")
    .insert({ plan_id: input.planId, code: input.code, full_name: input.fullName ?? input.code })
    .select("id")
    .single();
  if (error) throw new Error(`addTeacher: ${error.message}`);
  return { teacherId: data.id };
}
