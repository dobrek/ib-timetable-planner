import type { AppRole } from "./app-role";

/**
 * What a request needs (S-403). `session` is any signed-in user, role or not: their own account.
 * `read` and `edit` mirror the SQL wrappers `private.can_read()` and `private.can_edit()`, which are
 * the enforcement. This map only lets the app say "no" clearly before RLS says it silently.
 */
export type Capability = "session" | "read" | "edit";

/** Whether `role` holds `capability`. The role matrix pins the SQL side of the same map. */
export function grants(role: AppRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}

// A `Record` over the generated enum, so a new role does not compile until it is placed here.
const CAPABILITIES_BY_ROLE: Record<AppRole, readonly Capability[]> = {
  admin: ["session", "read", "edit"],
  author: ["session", "read", "edit"],
  viewer: ["session", "read"],
};
