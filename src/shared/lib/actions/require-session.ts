import { ActionError, type ActionAPIContext } from "astro:actions";

/**
 * Astro Actions POST to `/_actions/*`, which the middleware lists under PUBLIC_PREFIXES —
 * so the auth redirect does NOT gate them. Middleware still populates `locals.user` from
 * cookies on every request, so each handler must enforce the session itself.
 */
export function requireSession(context: ActionAPIContext): void {
  if (!context.locals.user) {
    throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
  }
}
