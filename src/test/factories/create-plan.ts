import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@/shared/api";
import { registerPlan } from "./teardown";

export type CreatePlanOptions = {
  /** Plan name; defaults to a collision-free `Factory Plan <uuid>`. */
  name?: string;
  /** Slot-grid preset; defaults to `5x10` (matches the seed). */
  slotGridPreset?: string;
};

/**
 * Insert a fresh `plans` row, register it for teardown, and return its id. The
 * default name is unique per call so parallel suites never collide on a shared
 * plan — the root of plan-rooted isolation.
 */
export async function createPlan(supabase: SupabaseClient, opts: CreatePlanOptions = {}): Promise<string> {
  const name = opts.name ?? `Factory Plan ${randomUUID()}`;
  const slot_grid_preset = opts.slotGridPreset ?? "5x10";

  const { data, error } = await supabase.from("plans").insert({ name, slot_grid_preset }).select("id").single();
  if (error) throw new Error(`createPlan: ${error.message}`);

  registerPlan(data.id);
  return data.id;
}
