import { actions } from "astro:actions";
import type { Cohort } from "@/shared/config";

type SlotBundleArgs = { planId: string; cohort: Cohort; day: number; period: number };

/** Ungroup a slot: persists an unbundled override (inserts the slot_bundles row). */
export async function unbundleSlot(args: SlotBundleArgs): Promise<void> {
  const { error } = await actions.unbundleSlot(args);
  if (error) throw new Error(error.message);
}

/** Re-group a slot: clears the unbundled override (deletes the slot_bundles row). */
export async function bundleSlot(args: SlotBundleArgs): Promise<void> {
  const { error } = await actions.bundleSlot(args);
  if (error) throw new Error(error.message);
}
