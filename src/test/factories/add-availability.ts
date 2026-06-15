import type { Database, SupabaseClient } from "@/shared/api";

export type AddAvailabilityInput = {
  planId: string;
  teacherId: string;
  day: number;
  period: number;
  severity: Database["public"]["Enums"]["availability_severity"];
};

/**
 * Insert one `teacher_availability` row (advanced constraint input) directly.
 * Absence of a row = available; a row marks a `(teacher, day, period)` cell as
 * `strong` (cannot) or `soft` (prefers not).
 */
export async function addAvailability(supabase: SupabaseClient, input: AddAvailabilityInput): Promise<void> {
  const { planId, teacherId, day, period, severity } = input;
  const { error } = await supabase
    .from("teacher_availability")
    .insert({ plan_id: planId, teacher_id: teacherId, day, period, severity });
  if (error) throw new Error(`addAvailability: ${error.message}`);
}
