import type { AppRole } from "./app-role";
import { grants, type Capability } from "./capability";

/**
 * What the middleware learned about the caller's role, on `locals.access`. `none` is a signed-in
 * user without a role (or no user at all); `unavailable` is a failed lookup, which must never be
 * read as `none`: an author is not told they lack access because of a blip.
 */
export type AccessState = { status: "granted"; role: AppRole } | { status: "none" } | { status: "unavailable" };

/** Whether `access` covers `capability`. `session` needs no role, so it holds in every state. */
export function allows(access: AccessState, capability: Capability): boolean {
  if (capability === "session") return true;
  return access.status === "granted" && grants(access.role, capability);
}
