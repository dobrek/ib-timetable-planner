import type { AccessState } from "./access-state";

/** Where a role-less user is sent: the dashboard renders FR-410's "no access yet" notice. */
export const ROLE_NOTICE_PATH = "/dashboard";

/** The 503 page a failed role lookup renders. It shows no plan data. */
export const ROLE_UNAVAILABLE_PATH = "/unavailable";

export type RoleGateDecision = "allow" | "notice" | "unavailable";

/**
 * The page gate's decision for a signed-in request on a non-public path (S-403, FR-410). Actions
 * are not gated here: each refuses insufficient capability itself (`requireCapability`).
 *
 * - a role-exempt path → `allow`, whatever the access;
 * - the notice page → `allow` for `granted` or `none` (it renders the notice), `unavailable` otherwise;
 * - any other path → `allow`, `notice` or `unavailable` by status.
 */
export function decideRoleGate(pathname: string, access: AccessState): RoleGateDecision {
  if (ROLE_EXEMPT_PATHS.includes(pathname)) return "allow";
  if (access.status === "unavailable") return "unavailable";
  if (access.status === "granted" || pathname === ROLE_NOTICE_PATH) return "allow";
  return "notice";
}

// Reachable signed in WITHOUT a role, and through a failed lookup. Every entry carries a one-line
// reason, like PUBLIC_PATHS in src/middleware.ts: anything listed here is open to a user an admin
// has given no access.
const ROLE_EXEMPT_PATHS: readonly string[] = [
  "/account", // FR-410: a role-less user manages their own account, and S-402's reset lands on ?notice=recovery
  "/api/solver/container", // an operator route with its own email allowlist, which reads no plan data
  ROLE_UNAVAILABLE_PATH, // the 503 page itself, which shows no plan data
];
