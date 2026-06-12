import type { SupabaseClient } from "@/shared/api";

/**
 * One hub row: identity + display fields, plus the entity counts the delete
 * dialog names as the cascade blast radius. No derived quality metrics (valid /
 * complete / used slots) — explicitly deferred.
 */
export type PlanRow = {
  id: string;
  name: string;
  slotGridPreset: string;
  /** ISO timestamp of the plans row's last update. */
  updatedAt: string;
  counts: PlanCounts;
};

export type PlanCounts = {
  students: number;
  courses: number;
  placements: number;
};

export type PlansResult = { kind: "ok"; plans: PlanRow[] } | { kind: "unavailable" };

/** Load plans + per-plan counts for the hub. Returns unavailable when client is null. */
export const loadPlans = async (supabase: SupabaseClient | null): Promise<PlansResult> => {
  if (!supabase) return { kind: "unavailable" };
  return { kind: "ok", plans: await fetchPlans(supabase) };
};

const fetchPlans = async (client: SupabaseClient): Promise<PlanRow[]> => {
  const { data, error } = await client
    .from("plans")
    .select("id, name, slot_grid_preset, updated_at")
    .order("name")
    .limit(200);
  if (error) throw new Error(`Plans lookup failed: ${error.message}`);

  // Per-plan head counts (3 queries per plan, parallel) — trivial at ≤ tens of plans.
  return Promise.all(
    data.map(async (row) => ({
      id: row.id,
      name: row.name,
      slotGridPreset: row.slot_grid_preset,
      updatedAt: row.updated_at,
      counts: await fetchCounts(client, row.id),
    })),
  );
};

const fetchCounts = async (client: SupabaseClient, planId: string): Promise<PlanCounts> => {
  const [students, courses, placements] = await Promise.all([
    countRows(client, "students", planId),
    countRows(client, "courses", planId),
    countRows(client, "placements", planId),
  ]);
  return { students, courses, placements };
};

const countRows = async (
  client: SupabaseClient,
  table: "students" | "courses" | "placements",
  planId: string,
): Promise<number> => {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("plan_id", planId);
  if (error) throw new Error(`Plan ${table} count failed: ${error.message}`);
  return count ?? 0;
};
