import { ActionError, type ActionAPIContext } from "astro:actions";
import { allows, type Capability } from "@/shared/config";
import { FORBIDDEN_MESSAGE } from "../errors";

/**
 * Refuse an action the caller's role does not cover (S-403), on the `locals.access` the middleware
 * read live for this request, so a role change applies on the next action. RLS is the enforcement;
 * this turns its silent 0-row denials into a clear error that rolls an optimistic board write back.
 *
 * - `session` → pass, role or not: the caller's own account;
 * - `granted` without the capability, or `none` → `FORBIDDEN`;
 * - `unavailable` → `SERVICE_UNAVAILABLE`: a failed lookup is never reported as "no permission".
 */
export function requireCapability(context: ActionAPIContext, capability: Capability): void {
  const { access } = context.locals;
  if (allows(access, capability)) return;
  if (access.status === "unavailable") {
    throw new ActionError({
      code: "SERVICE_UNAVAILABLE",
      message: "We couldn't check your access. Try again in a moment.",
    });
  }
  throw new ActionError({ code: "FORBIDDEN", message: FORBIDDEN_MESSAGE });
}
