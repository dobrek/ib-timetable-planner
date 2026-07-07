import { z } from "zod";
import type { PlannerPlacement } from "@/entities/timetable";
import { unwrapRow, type SupabaseClient } from "@/shared/api";
import { cohortSchema, placementWeekSchema, type PlacementWeek } from "@/shared/config";
import { GRID_BOUNDS } from "@/shared/lib/grid";
import { DomainError } from "@/shared/lib/errors";

type Supabase = SupabaseClient;

export const dayField = z.int().min(1).max(GRID_BOUNDS.maxDays);
export const periodField = z.int().min(1).max(GRID_BOUNDS.maxPeriods);

export const placeCourseInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  courseId: z.uuid(),
  day: dayField,
  period: periodField,
  // Agnostic courses default to `both`; the drop path resolves bi-weekly courses to `a`/`b`.
  week: placementWeekSchema.default("both"),
  // Carried so unshelve/undo-replay/duplicate restore a member's optional flag; fresh drops default false.
  isOptional: z.boolean().default(false),
});

/** Move a member-set (course ids) from a source cell to a target cell — single move, whole-bundle move, and merge are all this. */
export const moveBundleMembersInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  day: dayField,
  period: periodField,
  courseIds: z.array(z.uuid()).min(1),
  targetDay: dayField,
  targetPeriod: periodField,
});

/** Remove a member-set (course ids) from a cell — single remove and whole-bundle remove are both this. */
export const removeBundleMembersInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  day: dayField,
  period: periodField,
  courseIds: z.array(z.uuid()).min(1),
});

export const updatePlacementWeekInput = z.object({
  id: z.uuid(),
  week: placementWeekSchema,
});

export type PlaceCourseInput = z.infer<typeof placeCourseInput>;
export type MoveBundleMembersInput = z.infer<typeof moveBundleMembersInput>;
export type RemoveBundleMembersInput = z.infer<typeof removeBundleMembersInput>;
export type UpdatePlacementWeekInput = z.infer<typeof updatePlacementWeekInput>;

export type PlacementRow = {
  id: string;
  course_id: string;
  day: number;
  period: number;
  week: PlacementWeek;
  is_optional: boolean;
  bundle_id: string;
};

export const toPlannerPlacement = (row: PlacementRow): PlannerPlacement => ({
  id: row.id,
  courseId: row.course_id,
  day: row.day,
  period: row.period,
  week: row.week,
  isOptional: row.is_optional,
  bundleId: row.bundle_id,
});

/**
 * Place a single course-hour into its cell, creating the cell's bundle if absent —
 * one atomic round-trip via the `place_course` RPC. Idempotent on a duplicate course-hour
 * (the RPC returns the existing row). Returns the placement so the client reconciles its
 * optimistic id. Single-course add and group add (one call per member) both go through here.
 */
export const placeCourse = async (supabase: Supabase, input: PlaceCourseInput): Promise<PlannerPlacement> => {
  const { data, error } = await supabase.rpc("place_course", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_course_id: input.courseId,
    p_day: input.day,
    p_period: input.period,
    p_week: input.week,
    p_is_optional: input.isOptional,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to place course: ${error.message}`);
  return toPlannerPlacement(data);
};

/**
 * Move a member-set (course ids) from a source cell to a target cell atomically via the
 * `move_bundle_members` RPC — the unified primitive behind single-course move, whole-bundle
 * move, and merge. Returns the resulting placement rows at the target for client
 * reconciliation (mover rows keep their id; merger twins are returned as they already stood).
 */
export const moveBundleMembers = async (
  supabase: Supabase,
  input: MoveBundleMembersInput,
): Promise<PlannerPlacement[]> => {
  const { data, error } = await supabase.rpc("move_bundle_members", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_day: input.day,
    p_period: input.period,
    p_course_ids: input.courseIds,
    p_target_day: input.targetDay,
    p_target_period: input.targetPeriod,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to move bundle members: ${error.message}`);
  return data.map(toPlannerPlacement);
};

/**
 * Remove a member-set (course ids) from a cell atomically via the `remove_bundle_members`
 * RPC, deleting the cell's bundle when its last member goes (== 0 rule, server-enforced).
 * Single-course remove and whole-bundle remove are the same call, differing only in the set.
 */
export const removeBundleMembers = async (supabase: Supabase, input: RemoveBundleMembersInput): Promise<void> => {
  const { error } = await supabase.rpc("remove_bundle_members", {
    p_plan_id: input.planId,
    p_cohort: input.cohort,
    p_day: input.day,
    p_period: input.period,
    p_course_ids: input.courseIds,
  });
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to remove bundle members: ${error.message}`);
};

/**
 * Flip a single placement's fortnightly week (A ↔ B). The unique key excludes `week`, so
 * changing a placed course's week is an in-place update, not a re-insert. Used by the
 * per-chip A/B control; week changes never touch bundle membership.
 */
export const updatePlacementWeek = async (
  supabase: Supabase,
  input: UpdatePlacementWeekInput,
): Promise<PlannerPlacement> => {
  const updated = unwrapRow(
    await supabase.from("placements").update({ week: input.week }).eq("id", input.id).select().single(),
    { notFound: "Placement not found", failure: "Failed to update placement week" },
  );
  return toPlannerPlacement(updated);
};
