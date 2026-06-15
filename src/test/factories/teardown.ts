import type { SupabaseClient } from "@/shared/api";

// Per-test-file registry of factory-owned plan ids. Vitest isolates each test
// file in its own module context, so this Set is scoped to one suite — no
// cross-file leakage. `teardown` cascade-deletes every registered plan; because
// every domain table cascades from `plans.id`, one delete clears the whole graph.
const ownedPlanIds = new Set<string>();

/** Register an externally-created plan id (e.g. a `clone_plan` result) for teardown. */
export function registerPlan(planId: string): void {
  ownedPlanIds.add(planId);
}

/**
 * Cascade-delete every registered plan. Call in `afterAll`. Idempotent: clears
 * the registry so a second call is a no-op even if the suite re-runs teardown.
 */
export async function teardown(supabase: SupabaseClient): Promise<void> {
  if (ownedPlanIds.size === 0) return;
  const ids = [...ownedPlanIds];
  ownedPlanIds.clear();
  const { error } = await supabase.from("plans").delete().in("id", ids);
  if (error) throw new Error(`teardown: failed to delete plans: ${error.message}`);
}
