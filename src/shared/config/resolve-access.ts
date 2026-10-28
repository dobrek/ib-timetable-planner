import type { AccessState } from "./access-state";
import type { AppRole } from "./app-role";

/**
 * The middleware's whole interpretation of the role read, kept pure because it is the step that
 * decides who sees what. The lookup runs concurrently with `getUser()`, so it counts only once
 * `getUser()` has vouched for the session: the JWT alone is not revocation-checked.
 *
 * - no user → `none`, whatever the lookup said;
 * - a user and a rejected lookup → `unavailable`, never `none`;
 * - a user and a `null` role → `none`;
 * - a user and a role → `granted`.
 */
export function resolveAccess(hasUser: boolean, lookup: PromiseSettledResult<AppRole | null>): AccessState {
  if (!hasUser) return { status: "none" };
  if (lookup.status === "rejected") return { status: "unavailable" };
  return lookup.value === null ? { status: "none" } : { status: "granted", role: lookup.value };
}
