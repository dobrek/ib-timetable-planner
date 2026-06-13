import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type SupabaseClient = SupabaseClientGeneric<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route-param guard: true when the id is a well-formed plan UUID. */
export const isPlanId = (id: string | undefined): id is string => !!id && UUID_RE.test(id);

/** The plan context every plan-scoped page resolves: identity + display name + grid preset. */
export type PlanSummary = { id: string; name: string; slot_grid_preset: string };

/**
 * Resolve a route's plan param to its row, or null for a missing/garbage id (the page
 * 404s, mirroring the board's not-found branch). Genuine DB failures throw → 500.
 */
export const loadPlanSummary = async (
  supabase: SupabaseClient,
  id: string | undefined,
): Promise<PlanSummary | null> => {
  if (!isPlanId(id)) return null;

  const { data, error } = await supabase.from("plans").select("id, name, slot_grid_preset").eq("id", id).maybeSingle();
  if (error) throw new Error(`Plan lookup failed: ${error.message}`);
  return data;
};
