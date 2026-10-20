import { type AuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@/shared/api";
import type { EmailLink } from "../model/email-link";

/**
 * Why a link could not be used, in the two ways the visitor can act on:
 * - `expired`: GoTrue refused it — used, replaced by a newer email, expired, never existed (one
 *   403 `otp_expired` for all four), or the user is banned. Request a new link.
 * - `retry`: GoTrue was busy or unreachable, so the link is probably still good. Try it again.
 */
export type VerifyEmailLinkResult = { ok: true } | { ok: false; reason: "expired" | "retry" };

/**
 * Spend an email link (`POST /verify`). On success `@supabase/ssr` writes the session cookies, so
 * `client` must be the cookie-bound `createClient(headers, cookies)` — the visitor is signed in
 * from here on. A `token_hash` needs no verifier and no flow state, so this works on any device.
 *
 * Exactly `{ token_hash, type }`: GoTrue refuses `email` or `redirect_to` beside a `token_hash`.
 * Never throws; a thrown network error is a `retry`.
 */
export async function verifyEmailLink(client: SupabaseClient, link: EmailLink): Promise<VerifyEmailLinkResult> {
  try {
    const { error } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    return error ? { ok: false, reason: refusalReason(error) } : { ok: true };
  } catch {
    return { ok: false, reason: "retry" };
  }
}

const refusalReason = (error: AuthError): "expired" | "retry" =>
  isAuthRetryableFetchError(error) || error.code === "over_request_rate_limit" ? "retry" : "expired";
