/**
 * The `/auth/forgot` query vocabulary, in one place: the endpoints build their redirect targets
 * with `forgotPath`, and the page reads them back with `forgotPageState`.
 *
 * - `sent` is the one neutral answer to every reset request that passed the bot check.
 * - `verification` means the bot check refused or could not be reached.
 * - `unavailable` means reset is not configured (no Turnstile keys, no Supabase).
 * - `link-*` come back from `/api/auth/confirm` when an email link could not be used.
 */
export type ForgotReason = "sent" | "verification" | "unavailable" | "link-expired" | "link-invalid" | "link-retry";

/** The alerts the request form can show above itself. */
export type ForgotAlert = Extract<ForgotReason, "verification" | "link-expired" | "link-invalid" | "link-retry">;

export type ForgotPageState = { kind: "form"; alert: ForgotAlert | null } | { kind: "sent" } | { kind: "unavailable" };

export function forgotPath(reason: ForgotReason): string {
  return reason === "sent" ? "/auth/forgot?status=sent" : `/auth/forgot?error=${reason}`;
}

/**
 * Which state `/auth/forgot` renders. An unknown or hand-edited value reads as the plain form, and
 * an unconfigured deployment is always `unavailable`, whatever the query says.
 */
export function forgotPageState(
  searchParams: { get(name: string): string | null },
  { configured }: { configured: boolean },
): ForgotPageState {
  const error = searchParams.get("error");
  if (!configured || error === "unavailable") return { kind: "unavailable" };
  if (searchParams.get("status") === "sent") return { kind: "sent" };
  return { kind: "form", alert: isForgotAlert(error) ? error : null };
}

const FORGOT_ALERTS: readonly ForgotAlert[] = ["verification", "link-expired", "link-invalid", "link-retry"];

const isForgotAlert = (value: string | null): value is ForgotAlert => FORGOT_ALERTS.some((alert) => alert === value);
