import type { APIRoute } from "astro";
import { forgotPath, landingPathFor, parseEmailLink, verifyEmailLink } from "@/_pages/password-recovery";
import { createClient } from "@/shared/api";

/**
 * `POST /api/auth/confirm` — spend a one-time email link (S-402) and sign its holder in.
 *
 * The ONLY place a link is spent. `/auth/confirm` renders the Continue form on any method and has
 * no side effects, so a mail scanner that fetches the emailed URL spends nothing. This endpoint is
 * reached only by a person pressing Continue: only `POST` is exported, so GET and HEAD get Astro's
 * 404, and Astro's `checkOrigin` answers a cross-site form POST with 403 before this runs.
 *
 * Public through the middleware's `/api/auth/` prefix: the link holder is signed out until this
 * call signs them in. `verifyEmailLink` runs on the cookie-bound client, which writes the session.
 * The log names the outcome only, never the token.
 */
export const POST: APIRoute = async (context) => {
  const link = parseEmailLink(await context.request.formData().catch(() => new FormData()));
  if (!link) {
    // eslint-disable-next-line no-console
    console.info("[confirm-email-link] outcome=invalid");
    return context.redirect(forgotPath("link-invalid"), 303);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    // eslint-disable-next-line no-console
    console.error("[confirm-email-link] Supabase is not configured");
    return context.redirect(forgotPath("unavailable"), 303);
  }

  const result = await verifyEmailLink(supabase, link);
  if (result.ok) return context.redirect(landingPathFor(link.type), 303);
  // eslint-disable-next-line no-console
  console.info(`[confirm-email-link] outcome=${result.reason} type=${link.type}`);
  return context.redirect(forgotPath(result.reason === "expired" ? "link-expired" : "link-retry"), 303);
};
