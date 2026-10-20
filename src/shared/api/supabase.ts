import { createServerClient, parseCookieHeader, type CookieMethodsServer } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "./database.types";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  const cookieMethods = {
    getAll() {
      return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
        name,
        value: requiredCookieValue(value),
      }));
    },
    setAll(cookiesToSet, _headers) {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookies.set(name, value, options);
      });
    },
  } satisfies CookieMethodsServer;

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: cookieMethods,
  });
}

/**
 * A client that holds no session and touches no cookie, for the one Auth call that must not: the
 * password-reset request (`/recover`) on a public, signed-out endpoint. `createClient` above is
 * forced onto PKCE by `@supabase/ssr`, so the same call there would write a code-verifier cookie
 * to the visitor's browser and a `flow_state` row, neither of which the emailed `token_hash` link
 * ever uses. The implicit flow sends no code challenge, so the link verifies from any device.
 *
 * Never use it for a call that needs a session: it has none, and it never stores one.
 */
export function createSessionlessClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function requiredCookieValue(value: string | undefined): string {
  return value ?? "";
}
