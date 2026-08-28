import { unwrapMany, type SupabaseClient } from "@/shared/api";
import type { PlanIndicator } from "../model/plan-indicators";
import { surfacedJobsFor } from "./generation-status";

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

  // ONE query for the whole page, not one per plan. Its filter is `surfacedJobsFor` — the SAME
  // builder the poll's discovery read uses, so the first paint and the first tick cannot disagree
  // about which rows deserve a badge. (This used to inline a duplicate of that query, which is
  // exactly the drift S-306's wider filter would have caused.)
  const surfaced = await surfacedJobsFor(
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
      indicators: indicatorsOn(surfaced, row.id),
    })),
  );
};

/**
 * The indicators that belong on THIS row.
 *
 * A job names two plans, and the badge belongs on the proposal — that is the row it is about. It
 * falls back to the source only when the proposal row is not on this page at all, which on the SSR
 * path means the clone has been swept (`proposal_plan_id` is null); the loader always fetches the
 * whole page, so a live proposal is always here. `PlansHub` runs the same rule against the LIVE
 * snapshot, where the fallback does real work: a job discovered mid-poll may name a proposal row this
 * page has never loaded.
 */
const indicatorsOn = (surfaced: readonly PlanIndicator[], planId: string): PlanIndicator[] => {
  const onProposal = surfaced.filter((indicator) => indicator.proposalPlanId === planId);
  if (onProposal.length > 0) return onProposal;
  return surfaced.filter(
    (indicator) => indicator.planId === planId && (indicator.proposalPlanId === null || indicator.status === "failed"),
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
