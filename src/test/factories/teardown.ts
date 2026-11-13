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

/**
 * At most this many deletions in flight. GoTrue opens a database connection per request, and a
 * suite that registers dozens of users (the role matrix) would otherwise exhaust the local stack's
 * `max_connections` at once, failing the deletes with 53300.
 */
const USER_DELETE_BATCH = 8;

type UserDeleteOutcome = { userId: string; error: { code?: string; message: string } | null };

const deleteUsers = async (supabase: SupabaseClient, userIds: string[]): Promise<string[]> => {
  const outcomes = await batches(userIds, USER_DELETE_BATCH).reduce<Promise<UserDeleteOutcome[]>>(
    async (done, batch) => [
      ...(await done),
      ...(await Promise.all(batch.map((userId) => deleteUser(supabase, userId)))),
    ],
    Promise.resolve([]),
  );
  return outcomes.flatMap(({ userId, error }) =>
    error && error.code !== "user_not_found" ? [`failed to delete user ${userId}: ${error.message}`] : [],
  );
};

/**
 * One attempt is not enough. Two deletes in flight can each null a column of the same
 * `access_changes` row (the actor and the target), and Postgres aborts one of them. GoTrue reports
 * that as `ABORTED_DELETE`. The row is unchanged, so the delete is safe to repeat.
 */
const DELETE_ATTEMPTS = 3;
const ABORTED_DELETE = "Database error deleting user";

const deleteUser = async (
  supabase: SupabaseClient,
  userId: string,
  attemptsLeft: number = DELETE_ATTEMPTS,
): Promise<UserDeleteOutcome> => {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error?.message === ABORTED_DELETE && attemptsLeft > 1) return deleteUser(supabase, userId, attemptsLeft - 1);
  return { userId, error };
};

const batches = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
