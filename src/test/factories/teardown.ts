import type { SupabaseClient } from "@/shared/api";

// Per-test-file registries of factory-owned plan ids and Auth user ids. Vitest isolates each test
// file in its own module context, so these Sets are scoped to one suite — no cross-file leakage.
// `teardown` cascade-deletes every registered plan; because every domain table cascades from
// `plans.id`, one delete clears the whole graph. Auth users do NOT cascade from plans, so they need
// a registry of their own.
const ownedPlanIds = new Set<string>();
const ownedUserIds = new Set<string>();

/** Register an externally-created plan id (e.g. a `clone_plan` result) for teardown. */
export function registerPlan(planId: string): void {
  ownedPlanIds.add(planId);
}

/** Register a factory-created Auth user id for teardown. */
export function registerUser(userId: string): void {
  ownedUserIds.add(userId);
}

/**
 * Delete every registered plan, then every registered Auth user. Call in `afterAll`. Idempotent:
 * clears both registries so a second call is a no-op even if the suite re-runs teardown.
 *
 * `supabase` MUST be the service-role client. Through a role client, RLS would turn the plan
 * delete into a silent 0-row success and leak every row under it, and `auth.admin.deleteUser`
 * would be refused outright.
 *
 * Plans go first because users will outlive their references to them: S-403's `user_roles`
 * cascades from `auth.users`, and S-407's `created_by` is set to null. Both deletes are always
 * attempted, and every failure is reported in one error. A user who is already gone is not one.
 */
export async function teardown(supabase: SupabaseClient): Promise<void> {
  if (ownedPlanIds.size === 0 && ownedUserIds.size === 0) return;
  const planIds = [...ownedPlanIds];
  const userIds = [...ownedUserIds];
  ownedPlanIds.clear();
  ownedUserIds.clear();

  const planFailures = await deletePlans(supabase, planIds);
  const userFailures = await deleteUsers(supabase, userIds);
  const failures = [...planFailures, ...userFailures];
  if (failures.length > 0) throw new Error(`teardown: ${failures.join("; ")}`);
}

const deletePlans = async (supabase: SupabaseClient, planIds: string[]): Promise<string[]> => {
  if (planIds.length === 0) return [];
  const { error } = await supabase.from("plans").delete().in("id", planIds);
  return error ? [`failed to delete plans: ${error.message}`] : [];
};

const deleteUsers = async (supabase: SupabaseClient, userIds: string[]): Promise<string[]> => {
  const outcomes = await Promise.all(
    userIds.map(async (userId) => ({ userId, error: (await supabase.auth.admin.deleteUser(userId)).error })),
  );
  return outcomes.flatMap(({ userId, error }) =>
    error && error.code !== "user_not_found" ? [`failed to delete user ${userId}: ${error.message}`] : [],
  );
};
