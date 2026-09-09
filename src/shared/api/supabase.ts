import { createServerClient, parseCookieHeader, type CookieMethodsServer } from "@supabase/ssr";
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

function requiredCookieValue(value: string | undefined): string {
  return value ?? "";
}
