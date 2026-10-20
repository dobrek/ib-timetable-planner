import { type AuthError, isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * What became of a password-reset request, for the server log only. The endpoint answers every
 * request the same way whatever this says: the four refusals happen only for real accounts, so
 * letting any of them reach the visitor would tell them which addresses exist.
 *
 * - `accepted`: GoTrue answered 200. For an unknown address that is also 200, and nothing is sent.
 * - `throttled`: the per-user resend interval or the per-IP limiter.
 * - `rejected-address`: GoTrue refused the address itself.
 * - `send-failed`: GoTrue failed (5xx, e.g. SMTP refused or Resend's daily cap) or was unreachable.
 * - `unexpected`: anything else, including a code this list does not know.
 */
export type ResetOutcome = "accepted" | "throttled" | "rejected-address" | "send-failed" | "unexpected";

/** One log line's worth: the outcome, plus GoTrue's code and HTTP status when it gave them. */
export type ResetReport = { outcome: ResetOutcome; code: string | null; status: number | null };

/** Classify the error `resetPasswordForEmail` returned or threw; `null` means it succeeded. */
export function toResetReport(error: unknown): ResetReport {
  if (error === null || error === undefined) return { outcome: "accepted", code: null, status: null };
  if (!isAuthError(error)) return { outcome: "unexpected", code: null, status: null };
  return { outcome: outcomeOf(error), code: error.code ?? null, status: error.status ?? null };
}

/**
 * The log line for a report. It names the outcome, code and status and nothing else — never the
 * email address, and never GoTrue's message, which may quote what it was sent.
 */
export function formatResetReport({ outcome, code, status }: ResetReport): string {
  return `[forgot-password] outcome=${outcome} code=${code ?? "-"} status=${status ?? "-"}`;
}

const OUTCOME_BY_CODE: Readonly<Record<string, ResetOutcome>> = {
  over_email_send_rate_limit: "throttled",
  over_request_rate_limit: "throttled",
  email_address_invalid: "rejected-address",
  email_address_not_authorized: "rejected-address",
  validation_failed: "rejected-address",
};

// supabase-js turns every 5xx and every network failure into a retryable error with no code.
const outcomeOf = (error: AuthError): ResetOutcome =>
  isAuthRetryableFetchError(error) ? "send-failed" : (OUTCOME_BY_CODE[error.code ?? ""] ?? "unexpected");
