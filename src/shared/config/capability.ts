import type { AppRole } from "./app-role";

/**
 * What a request needs (S-403). `session` is any signed-in user, role or not: their own account.
 * `read`, `edit`, `manage_users` (S-406) and `stop_any_job` (S-407) mirror the SQL wrappers
 * `private.can_read()`, `private.can_edit()`, `private.can_manage_users()` and
 * `private.can_stop_any_job()`, which are the enforcement: RLS for the first three, and the
 * `generation_jobs_guard_attribution` trigger for the last. This map only lets the app say "no"
 * clearly before the database says it.
 *
 * `stop_any_job` is stopping a generation job someone else requested. Stopping one's own needs only
 * `edit`, and so does stopping a job that records no requester.
 */
export type Capability = "session" | "read" | "edit" | "manage_users" | "stop_any_job";

/** Whether `role` holds `capability`. The role matrix pins the SQL side of the same map. */
export function grants(role: AppRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}

// A `Record` over the generated enum, so a new role does not compile until it is placed here.
const CAPABILITIES_BY_ROLE: Record<AppRole, readonly Capability[]> = {
  admin: ["session", "read", "edit", "manage_users", "stop_any_job"],
  author: ["session", "read", "edit"],
  viewer: ["session", "read"],
};
