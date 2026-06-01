import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

// Deny-by-default: every route requires an authenticated session except the
// paths below. Keep this allowlist tight — only the sign-in surface, the auth
// API endpoints, and static/internal assets are reachable unauthenticated.
const PUBLIC_PATHS = ["/auth/signin"];
const PUBLIC_PREFIXES = [
  "/api/auth/", // sign-in / sign-out endpoints
  "/_", // Astro internals (e.g. /_astro/, /_image, /_server-islands)
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // Static files in public/ are served at the root with a file extension
  // (e.g. /favicon.png). Only known asset extensions are exempted — keeps
  // future extension-bearing routes (e.g. /api/export.csv) auth-gated.
  if (/\.(css|js|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map)$/.test(pathname)) return true;
  return false;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[middleware] auth.getUser failed:", error.message);
    }
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (!isPublicPath(context.url.pathname) && !context.locals.user) {
    return context.redirect("/auth/signin");
  }

  return next();
});
