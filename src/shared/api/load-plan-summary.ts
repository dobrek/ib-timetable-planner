import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type SupabaseClient = SupabaseClientGeneric<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The plan context every plan-scoped page resolves: identity + display name. */
export type PlanSummary = { id: string; name: string };

/**
 * Resolve a route's plan param to its row, or null for a missing/garbage id (the page
 * 404s, mirroring the board's not-found branch). Genuine DB failures throw → 500.
 */
export const loadPlanSummary = async (
  supabase: SupabaseClient,
  id: string | undefined,
): Promise<PlanSummary | null> => {
  if (!id || !UUID_RE.test(id)) return null;

  const { data, error } = await supabase.from("plans").select("id, name").eq("id", id).maybeSingle();
  if (error) throw new Error(`Plan lookup failed: ${error.message}`);
  return data;
};
