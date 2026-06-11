import { z } from "zod";
import { GRID_BOUNDS } from "../model/grid";
import type { PlannerPlacement } from "../model/placement";
import type { SupabaseClient } from "@/shared/api";
import { cohortSchema } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import { UNIQUE_VIOLATION } from "@/shared/lib/postgrest";

type Supabase = SupabaseClient;

export const createPlacementInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  courseId: z.uuid(),
  day: z.int().min(1).max(GRID_BOUNDS.maxDays),
  period: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
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
  const { planId, cohort, courseId, day, period } = input;

  const { data, error } = await supabase
    .from("placements")
    .insert({ plan_id: planId, cohort, course_id: courseId, day, period })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: lookupError } = await supabase
      .from("placements")
      .select()
      .eq("plan_id", planId)
      .eq("cohort", cohort)
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
