import type { SupabaseClient } from "@/shared/api";

// Local view model — project DB rows to just what this list needs (lessons rule #1).
export type PlanRow = { id: string; name: string };

export type PlansResult = { kind: "ok"; plans: PlanRow[] } | { kind: "unavailable" };

const fetchPlans = async (client: SupabaseClient): Promise<PlanRow[]> => {
  const { data, error } = await client.from("plans").select("id, name").order("name").limit(200);
  if (error) throw new Error(`Plans lookup failed: ${error.message}`);
  return data.map((row) => ({ id: row.id, name: row.name }));
};

/** Load plans for the list page. Returns unavailable when client is null. */
export const loadPlans = async (supabase: SupabaseClient | null): Promise<PlansResult> => {
  if (!supabase) return { kind: "unavailable" };
  return { kind: "ok", plans: await fetchPlans(supabase) };
};
