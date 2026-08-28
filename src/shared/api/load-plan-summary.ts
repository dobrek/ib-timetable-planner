import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type SupabaseClient = SupabaseClientGeneric<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route-param guard: true when the id is a well-formed UUID. */
export const isUuid = (id: string | undefined): id is string => !!id && UUID_RE.test(id);

/** Route-param guard: true when the id is a well-formed plan UUID. */
export const isPlanId = isUuid;

/** The plan context every plan-scoped page resolves: identity + display name + grid preset. */
export type PlanSummary = {
  id: string;
  name: string;
  slot_grid_preset: string;
  /**
   * True while this plan is a generation proposal whose board has not landed yet (S-306). Every
   * plan-scoped by-id surface must refuse a pending plan — it is the apply target of a solve that
   * may still be running, and an edit to its catalog kills the delivery it is waiting for.
   */
  pending_proposal: boolean;
};

/**
 * Whether this plan is a proposal that is still being generated.
 *
 * A named predicate rather than a bare field read, because it is the ONE thing every plan-scoped
 * page has to remember, and the roadmap names forgetting it as this slice's residual risk: the
 * guard surface was enumerated from today's routes, so a future plan-scoped page inherits nothing.
 * Grepping for this symbol is how the next author finds the whole set.
 */
export const isPendingProposal = (plan: PlanSummary): boolean => plan.pending_proposal;

/**
 * Resolve a route's plan param to its row, or null for a missing/garbage id (the page
 * 404s, mirroring the board's not-found branch). Genuine DB failures throw → 500.
 */
export const loadPlanSummary = async (
  supabase: SupabaseClient,
  id: string | undefined,
): Promise<PlanSummary | null> => {
  if (!isPlanId(id)) return null;

  const { data, error } = await supabase
    .from("plans")
    .select("id, name, slot_grid_preset, pending_proposal")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Plan lookup failed: ${error.message}`);
  return data;
};
