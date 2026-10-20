import type { APIContext, APIRoute } from "astro";
import { TURNSTILE_SECRET_KEY } from "astro:env/server";
import { forgotPath, formatResetReport, requestPasswordReset, verifyTurnstile } from "@/_pages/password-recovery";
import { createSessionlessClient } from "@/shared/api";

/**
 * `POST /api/auth/forgot` — request a password-reset email (S-402, FR-412).
 *
 * Public through the middleware's `/api/auth/` prefix, so it must be safe signed out, and it is:
 * the Turnstile check gates the only side effect. Only `POST` is exported, so GET and HEAD get
 * Astro's 404; Astro's `checkOrigin` answers a cross-site form POST with 403 before this runs.
 *
 * Every request that passes the check gets the SAME answer, by content and by timing: the reset is
 * handed to `waitUntil` and the redirect does not wait for it, so neither the page nor the response
 * time says whether the address has an account. The real outcome goes to the log only, as
 * `formatResetReport` writes it — never the address, the token or the Turnstile response.
 */
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => new FormData());
  const verdict = await verifyTurnstile({
    token: form.get("cf-turnstile-response"),
    secret: TURNSTILE_SECRET_KEY,
    remoteIp: clientAddressOf(context),
    requestHost: context.url.hostname,
  });
  if (verdict === "misconfigured") {
    // eslint-disable-next-line no-console
    console.error("[forgot-password] turnstile=misconfigured: reset is unavailable until the keys are fixed");
    return context.redirect(forgotPath("unavailable"), 303);
  }
  if (verdict !== "pass") {
    // eslint-disable-next-line no-console
    console.info(`[forgot-password] turnstile=${verdict}`);
    return context.redirect(forgotPath("verification"), 303);
  }

  const client = createSessionlessClient();
  if (!client) {
    // eslint-disable-next-line no-console
    console.error("[forgot-password] Supabase is not configured: reset is unavailable");
    return context.redirect(forgotPath("unavailable"), 303);
  }
  const email = form.get("email");
  if (typeof email === "string") {
    context.locals.cfContext.waitUntil(
      requestPasswordReset(client, email).then((report) => {
        // eslint-disable-next-line no-console
        console.info(formatResetReport(report));
      }),
    );
  }
  return context.redirect(forgotPath("sent"), 303);
};

// Astro's getter throws when the adapter found no `cf-connecting-ip`; siteverify's `remoteip` is
// optional, so an unknown address is sent as none rather than failing the request.
const clientAddressOf = (context: APIContext): string | undefined => {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
};
