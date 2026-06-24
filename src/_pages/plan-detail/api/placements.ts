import { z } from "zod";
import type { PlannerPlacement } from "../model/placement";
import { UNIQUE_VIOLATION, unwrapRow, unwrapMaybeRow, unwrapCompleted, type SupabaseClient } from "@/shared/api";
import { cohortSchema, placementWeekSchema, type Cohort, type PlacementWeek } from "@/shared/config";
import { GRID_BOUNDS } from "@/shared/lib/grid";
import { DomainError } from "@/shared/lib/errors";

type Supabase = SupabaseClient;

export const createPlacementInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  courseId: z.uuid(),
  day: z.int().min(1).max(GRID_BOUNDS.maxDays),
  period: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
  // Agnostic courses default to `both`; the drop path resolves bi-weekly courses to `a`/`b`.
  week: placementWeekSchema.default("both"),
});

export const deletePlacementInput = z.object({
  id: z.uuid(),
});

export const updatePlacementWeekInput = z.object({
  id: z.uuid(),
  week: placementWeekSchema,
});

export type CreatePlacementInput = z.infer<typeof createPlacementInput>;
export type DeletePlacementInput = z.infer<typeof deletePlacementInput>;
export type UpdatePlacementWeekInput = z.infer<typeof updatePlacementWeekInput>;

type PlacementRow = { id: string; course_id: string; day: number; period: number; week: PlacementWeek };

const toPlannerPlacement = (row: PlacementRow): PlannerPlacement => ({
  id: row.id,
  courseId: row.course_id,
  day: row.day,
  period: row.period,
  week: row.week,
});

/**
 * Insert a single course-hour into its cell's bundle. Idempotent on placements_unique:
 * if the same course-hour already sits in the cell, load and return the existing row so
 * the client reconciles its optimistic id — never a rollback, never a 500.
 *
 * PHASE-1 BRIDGE: `placements.bundle_id` is now `NOT NULL`, so every placement must name
 * its bundle. Until the atomic `place_course` RPC lands (Phase 2) and the persistence
 * layer is folded onto it (Phase 3), this find-or-creates the cell's placed bundle, then
 * inserts the placement with that id — a raw two-step with no RPC dependency. The
 * returned shape is unchanged (no `bundleId` yet); render still derives bundled-ness from
 * occupant count, so nothing reads the new column this phase.
 */
export const insertPlacement = async (supabase: Supabase, input: CreatePlacementInput): Promise<PlannerPlacement> => {
  const { planId, cohort, courseId, day, period, week } = input;
  const bundleId = await findOrCreatePlacedBundle(supabase, { planId, cohort, day, period });

  const { data, error } = await supabase
    .from("placements")
    .insert({ plan_id: planId, cohort, course_id: courseId, day, period, week, bundle_id: bundleId })
    .select()
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const existing = unwrapRow(
      await supabase
        .from("placements")
        .select()
        .eq("plan_id", planId)
        .eq("cohort", cohort)
        .eq("course_id", courseId)
        .eq("day", day)
        .eq("period", period)
        .single(),
      { failure: "Failed to load existing placement" },
    );
    return toPlannerPlacement(existing);
  }

  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to insert placement: ${error.message}`);
  }

  return toPlannerPlacement(data);
};

/** Remove a single placement row by id. Move is expressed client-side as POST-new → DELETE-old. */
export const removePlacement = async (supabase: Supabase, input: DeletePlacementInput): Promise<{ id: string }> => {
  unwrapCompleted(await supabase.from("placements").delete().eq("id", input.id), "Failed to delete placement");
  return { id: input.id };
};

/**
 * Flip a single placement's fortnightly week (A ↔ B). The insert path is idempotent on the
 * unique key — which excludes `week` — so changing a placed course's week is an update, not
 * a re-insert. Used by the per-chip A/B control.
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

type BundleCell = { planId: string; cohort: Cohort; day: number; period: number };

/**
 * Find-or-create the cell's placed bundle, returning its id. PHASE-1 BRIDGE only — the
 * `place_course` RPC absorbs this into one atomic upsert in Phase 2. Handles the create
 * race (the move path POSTs movers in parallel, so two inserts can target one new cell):
 * on a `bundles_cell_unique` violation, re-read the winner's row rather than fail.
 */
const findOrCreatePlacedBundle = async (supabase: Supabase, cell: BundleCell): Promise<string> => {
  const existing = await selectBundleId(supabase, cell);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("bundles")
    .insert({ plan_id: cell.planId, cohort: cell.cohort, status: "placed", day: cell.day, period: cell.period })
    .select("id")
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    const raced = await selectBundleId(supabase, cell);
    if (raced) return raced;
    throw new DomainError("INTERNAL_SERVER_ERROR", "Bundle vanished after a unique-violation re-read");
  }
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to create bundle: ${error.message}`);
  }
  return data.id;
};

const selectBundleId = async (supabase: Supabase, cell: BundleCell): Promise<string | null> => {
  const row = unwrapMaybeRow(
    await supabase
      .from("bundles")
      .select("id")
      .eq("plan_id", cell.planId)
      .eq("cohort", cell.cohort)
      .eq("day", cell.day)
      .eq("period", cell.period)
      .maybeSingle(),
    "Failed to load bundle for cell",
  );
  return row?.id ?? null;
};
