import { unwrapMany, type SupabaseClient } from "@/shared/api";
import { toGenerationIndicators, type PlanIndicator } from "../model/plan-indicators";

/**
 * One hub row: identity + display fields, plus the entity counts the delete
 * dialog names as the cascade blast radius. No derived quality metrics (valid /
 * complete / used slots) — still explicitly deferred, because each of those means
 * computing a board per plan on every page load.
 *
 * `indicators` is not an exception to that rule; it is what the rule leaves room for.
 * The generation indicator READS a durable, indexed row rather than deriving anything,
 * so it costs one query for the whole page however many plans there are.
 */
export type PlanRow = {
  id: string;
  name: string;
  slotGridPreset: string;
  /** ISO timestamp of the plans row's last update. */
  updatedAt: string;
  counts: PlanCounts;
  /** Live-ish activity on this plan, SSR'd. At most one entry today. */
  indicators: PlanIndicator[];
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
  const rows = unwrapMany(
    await client.from("plans").select("id, name, slot_grid_preset, updated_at").order("name").limit(200),
    "Plans lookup failed",
  );

  // ONE query for the whole page, not one per plan: the `generation_jobs_active_per_plan` partial
  // unique index guarantees at most one active job per plan, so this returns ≤ rows.length rows.
  const active = await fetchActiveIndicators(
    client,
    rows.map((row) => row.id),
  );

  // Per-plan head counts (3 queries per plan, parallel) — trivial at ≤ tens of plans.
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      slotGridPreset: row.slot_grid_preset,
      updatedAt: row.updated_at,
      counts: await fetchCounts(client, row.id),
      indicators: active.get(row.id) ?? [],
    })),
  );
};

/**
 * The active generation job per plan, as the indicators the hub renders and the poll store starts
 * from.
 *
 * The projection is explicit and narrow, and that is a correctness rule rather than an optimisation
 * on this table: `snapshot` is ~124 KB and TOASTed, `result` ~35 KB and `checkpoint` ~35 KB, so a
 * bare `select()` would drag hundreds of kilobytes per row into a page that shows one line of text.
 */
const fetchActiveIndicators = async (
  client: SupabaseClient,
  planIds: string[],
): Promise<Map<string, PlanIndicator[]>> => {
  if (planIds.length === 0) return new Map();
  const jobs = unwrapMany(
    await client
      .from("generation_jobs")
      .select("id, plan_id, status, stage_index, stage_name, created_at")
      .in("status", ["queued", "running"])
      .in("plan_id", planIds),
    "Generation activity lookup failed",
  );
  return new Map(toGenerationIndicators(jobs).map((indicator) => [indicator.planId, [indicator]]));
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
