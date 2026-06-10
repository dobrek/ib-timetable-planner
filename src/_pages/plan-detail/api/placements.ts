import { z } from "zod";
import type { PlannerPlacement } from "@/_pages/plan-detail/model/placement";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { UNIQUE_VIOLATION } from "@/shared/lib/postgrest";

type Supabase = SupabaseClient;

export const createPlacementInput = z.object({
  variantId: z.uuid(),
  cohortId: z.uuid(),
  courseId: z.uuid(),
  day: z.int().min(1).max(5),
  period: z.int().min(1).max(10),
});

export const deletePlacementInput = z.object({
  id: z.uuid(),
});

export type CreatePlacementInput = z.infer<typeof createPlacementInput>;
export type DeletePlacementInput = z.infer<typeof deletePlacementInput>;

type PlacementRow = { id: string; course_id: string; day: number; period: number };

const toPlannerPlacement = (row: PlacementRow): PlannerPlacement => ({
  id: row.id,
  courseId: row.course_id,
  day: row.day,
  period: row.period,
});

/**
 * Insert a single course-hour. Idempotent on placements_unique: if the same
 * course-hour already sits in the cell, load and return the existing row so the
 * client reconciles its optimistic id — never a rollback, never a 500.
 */
export const insertPlacement = async (supabase: Supabase, input: CreatePlacementInput): Promise<PlannerPlacement> => {
  const { variantId, cohortId, courseId, day, period } = input;

  const { data, error } = await supabase
    .from("placements")
    .insert({ variant_id: variantId, cohort_id: cohortId, course_id: courseId, day, period })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: lookupError } = await supabase
      .from("placements")
      .select()
      .eq("variant_id", variantId)
      .eq("cohort_id", cohortId)
      .eq("course_id", courseId)
      .eq("day", day)
      .eq("period", period)
      .single();
    if (lookupError) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to load existing placement: ${lookupError.message}`);
    }
    return toPlannerPlacement(existing);
  }

  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to insert placement: ${error.message}`);
  }

  return toPlannerPlacement(data);
};

/** Remove a single placement row by id. Move is expressed client-side as POST-new → DELETE-old. */
export const removePlacement = async (supabase: Supabase, input: DeletePlacementInput): Promise<{ id: string }> => {
  const { error } = await supabase.from("placements").delete().eq("id", input.id);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete placement: ${error.message}`);
  }
  return { id: input.id };
};
