/**
 * Whether the solver container's operator allowlist is closed, and if not, whether it names `email`.
 *
 * - `closed`: `SOLVER_OPS_ALLOWED_EMAILS` is unset or empty. Deny-by-default, like the middleware:
 *   nobody may operate, and a route guarded by this should not admit that it exists.
 * - `denied`: the list names someone, but not this address.
 * - `allowed`: the list names this address.
 *
 * Three answers rather than a boolean because a guarded route answers the first two differently (404
 * and 403). The list is comma-separated; entries and the address are compared trimmed and
 * case-insensitively, because an email's case carries no identity.
 *
 * Lives at the top level of `src/` beside the route handler that is its only consumer, like the rest
 * of the container wiring (`steiger` does not inspect top-level files).
 */
export type OpsAccess = "closed" | "denied" | "allowed";

export const checkOpsAccess = (email: string | null | undefined, allowlist: string | undefined): OpsAccess => {
  const entries = (allowlist ?? "").split(",").map(normalize).filter(Boolean);
  if (entries.length === 0) return "closed";
  const address = normalize(email ?? "");
  return address && entries.includes(address) ? "allowed" : "denied";
};

const normalize = (value: string): string => value.trim().toLowerCase();
