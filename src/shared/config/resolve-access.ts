import type { AccessState } from "./access-state";
import type { AppRole } from "./app-role";

/**
 * What the middleware reads about the caller: the role `own_app_role()` answers, and, only when
 * that is null, whether the caller is on a temporary password. `mustChangePassword` is false
 * whenever a role is held, because the flag is what makes the role read null.
 */
export type OwnAccessRead = { role: AppRole | null; mustChangePassword: boolean };

/**
 * The middleware's whole interpretation of the access read, kept pure because it is the step that
 * decides who sees what. The lookup runs concurrently with `getUser()`, so it counts only once
 * `getUser()` has vouched for the session: the JWT alone is not revocation-checked.
 *
 * - no user → `none`, whatever the lookup said;
 * - a user and a rejected lookup (the role read or the flag read) → `unavailable`, never `none`;
 * - a user and a role → `granted`;
 * - a user with no role who must change their password → `password_change_required`;
 * - a user with no role and no flag → `none`: never given one, or deactivated (S-408), whose kept
 *   role `own_app_role()` reads as null.
 */
export function resolveAccess(hasUser: boolean, lookup: PromiseSettledResult<OwnAccessRead>): AccessState {
  if (!hasUser) return { status: "none" };
  if (lookup.status === "rejected") return { status: "unavailable" };
  const { role, mustChangePassword } = lookup.value;
  if (role !== null) return { status: "granted", role };
  return mustChangePassword ? { status: "password_change_required" } : { status: "none" };
}
