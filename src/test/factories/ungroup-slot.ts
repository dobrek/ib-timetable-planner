import { insertOverride, type UnbundleSlotInput } from "@/_pages/plan-detail/api/slot-bundles";
import type { SupabaseClient } from "@/shared/api";

/**
 * Produce a slot-bundle un-group exception (board **output**) by driving the real
 * `insertOverride` domain function. `slot_bundles` semantics are inverted: a row
 * is the explicit un-bundle of an otherwise-bundled cell.
 */
export function ungroupSlot(supabase: SupabaseClient, input: UnbundleSlotInput) {
  return insertOverride(supabase, input);
}
