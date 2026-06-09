import { ActionError, type ActionAPIContext } from "astro:actions";
import { createClient } from "@/shared/api";
import { DomainError } from "./errors";

type Supabase = NonNullable<ReturnType<typeof createClient>>;

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

export function requireSupabase(context: ActionAPIContext): Supabase {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: "Supabase is not configured." });
  }
  return supabase;
}

/**
 * Run a domain function and translate its framework-free `DomainError` into Astro's
 * `ActionError` (codes are a 1:1 subset). Non-domain throws propagate unchanged.
 */
export async function runDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainError) {
      throw new ActionError({ code: error.code, message: error.message });
    }
    throw error;
  }
}
