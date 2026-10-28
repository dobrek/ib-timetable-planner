import { defineMiddleware } from "astro:middleware";
import { createClient, loadOwnRole, type SupabaseClient } from "@/shared/api";
import { decideRoleGate, resolveAccess, ROLE_NOTICE_PATH, ROLE_UNAVAILABLE_PATH, type AppRole } from "@/shared/config";

// Deny-by-default: every route requires an authenticated session except the
// paths below. Keep this allowlist tight — only the sign-in and password-reset
// pages, the auth API endpoints, and static/internal assets are reachable
// unauthenticated.
// Every entry carries a one-line reason (PRD Constraints).
const PUBLIC_PATHS = [
  "/auth/signin", // a signed-out user must be able to sign in
  "/auth/forgot", // a signed-out user must be able to ask for a reset link (S-402, FR-412)
  "/auth/confirm", // the link holder is signed out until they press Continue (S-402)
];
const PUBLIC_PREFIXES = [
  // signin, signout, forgot, confirm. ANY file placed under this prefix is public without
  // anyone deciding so, and must be safe signed out.
  "/api/auth/",
  "/_", // Astro internals (e.g. /_astro/, /_image, /_server-islands)
];

// Astro Actions sit under the public `/_` prefix, so the page gates below never see them. They
// still get the role read: `defineDomainAction` refuses insufficient capability on `locals.access`.
const ACTIONS_PREFIX = "/_actions/";

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
  const { pathname } = context.url;
  const isPublic = isPublicPath(pathname);
  const supabase = createClient(context.request.headers, context.cookies);

  // The role is read live, concurrently with getUser(), so it costs max(GoTrue, PostgREST) rather
  // than their sum. Public paths other than actions skip it and hold no access.
  const readsRole = !isPublic || pathname.startsWith(ACTIONS_PREFIX);
  const [user, lookup] = await Promise.all([
    readUser(supabase),
    supabase && readsRole ? settleRole(supabase) : undefined,
  ]);
  context.locals.user = user;
  context.locals.access = lookup ? resolveAccess(user !== null, lookup) : { status: "none" };
  if (user && lookup?.status === "rejected") {
    // eslint-disable-next-line no-console -- the server log is the only trace of a 503 page or action
    console.error(
      "[middleware] role lookup failed:",
      lookup.reason instanceof Error ? lookup.reason.message : lookup.reason,
    );
  }

  if (isPublic) return next();
  if (!user) return context.redirect("/auth/signin");

  // The page gate (S-403, FR-410): a role-less user lands on the dashboard's notice.
  const gate = decideRoleGate(pathname, context.locals.access);
  if (gate === "notice") return context.redirect(ROLE_NOTICE_PATH);
  // `next(path)` renders the 503 page once, without re-entering this middleware. Never
  // `context.rewrite()`: it re-runs the chain, repeating getUser() and the role read.
  if (gate === "unavailable") return next(ROLE_UNAVAILABLE_PATH);
  return next();
});

async function readUser(supabase: SupabaseClient | null): Promise<App.Locals["user"]> {
  if (!supabase) return null;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[middleware] auth.getUser failed:", error.message);
  }
  return user ?? null;
}

/** The role read's outcome as a value: a failure must reach `resolveAccess`, not throw past it. */
async function settleRole(supabase: SupabaseClient): Promise<PromiseSettledResult<AppRole | null>> {
  const [lookup] = await Promise.allSettled([loadOwnRole(supabase)]);
  return lookup;
}
