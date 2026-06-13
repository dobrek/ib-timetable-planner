import { z } from "zod";
import { GRID_BOUNDS } from "../model/grid";
import type { SupabaseClient } from "@/shared/api";
import { cohortSchema } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import { UNIQUE_VIOLATION } from "@/shared/lib/postgrest";

/**
 * Slot-bundle overrides have INVERTED semantics: a `slot_bundles` row PRESENT
 * means the cell is **UNbundled** (the opt-out exception). So the UI verbs map to
 * the opposite DB op — `unbundleSlot` (UI: "Ungroup slot") **inserts** the override
 * row, and `bundleSlot` (UI: "Group slot") **deletes** it. Don't let a future reader
 * wire the verb→op mapping backwards: insert = unbundle, delete = bundle.
 */

type Supabase = SupabaseClient;

const slotBundleInput = z.object({
  planId: z.uuid(),
  cohort: cohortSchema,
  day: z.int().min(1).max(GRID_BOUNDS.maxDays),
  period: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
});

export const unbundleSlotInput = slotBundleInput;
export const bundleSlotInput = slotBundleInput;

export type UnbundleSlotInput = z.infer<typeof unbundleSlotInput>;
export type BundleSlotInput = z.infer<typeof bundleSlotInput>;

/**
 * Insert an unbundled override for a cell. Idempotent on slot_bundles_unique: a
 * second insert for the same cell swallows the unique violation (like
 * `insertPlacement`), so re-ungrouping an already-ungrouped slot is a no-op.
 */
export const insertOverride = async (supabase: Supabase, input: UnbundleSlotInput): Promise<void> => {
  const { planId, cohort, day, period } = input;

  const { error } = await supabase.from("slot_bundles").insert({ plan_id: planId, cohort, day, period });

  if (error?.code === UNIQUE_VIOLATION) return;
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to insert slot bundle override: ${error.message}`);
  }
};

/** Delete the unbundled override for a cell by coordinate. Re-groups the slot. No-op if absent. */
export const deleteOverride = async (supabase: Supabase, input: BundleSlotInput): Promise<void> => {
  const { planId, cohort, day, period } = input;

  const { error } = await supabase
    .from("slot_bundles")
    .delete()
    .eq("plan_id", planId)
    .eq("cohort", cohort)
    .eq("day", day)
    .eq("period", period);

  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to delete slot bundle override: ${error.message}`);
  }
};
