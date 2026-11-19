import {
  globalFetch,
  NO_ANSWER,
  SEND_TIMEOUT_MS,
  type FetchLike,
  type MailSender,
  type MailTransport,
  type SendOutcome,
} from "./mail-transport";

export type ResendTransportOptions = {
  /** A sending-only key restricted to the sending domain, separate from the SMTP key Supabase holds. */
  apiKey: string;
  from: MailSender;
  fetch?: FetchLike;
  timeoutMs?: number;
};

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/**
 * Resend's API refuses a request with no `User-Agent` (403). A generic client name, never a person's
 * or a project's contact details.
 */
const USER_AGENT = "job-email-notifier/1";

/**
 * Send through Resend's HTTP API (`POST /emails`), with the message's `Idempotency-Key`.
 *
 * Its answers, classified (Resend's error reference, read 2026-11-16 and 2026-11-19):
 * - 2xx: sent.
 * - 409 `concurrent_idempotent_requests`: the same key is still in flight.
 * - 409 `invalid_idempotent_request`: the key was used within 24 h with a different body. Resend
 *   stores only successful sends, so an earlier attempt went out: already sent.
 * - 429 `daily_quota_exceeded` / `monthly_quota_exceeded`: the shared quota is spent, which no retry
 *   this run can change. 429 `rate_limit_exceeded`: too fast. Both stop the run.
 * - 401 or 403: a revoked, invalid or restricted key, or an unverified domain. Every message fails
 *   alike, so retrying each one only spends calls: stop the run.
 * - anything else, or no answer at all: this message failed.
 */
export function createResendTransport({
  apiKey,
  from,
  fetch = globalFetch,
  timeoutMs = SEND_TIMEOUT_MS,
}: ResendTransportOptions): MailTransport {
  return {
    send: async (message) => {
      const response = await fetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          from: `${from.name} <${from.address}>`,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      if (response === null) return NO_ANSWER;
      if (response.ok) return { kind: "sent" };
      return classify(response.status, await errorName(response));
    },
  };
}

const classify = (status: number, name: string): SendOutcome => {
  if (status === 409 && name === "concurrent_idempotent_requests") return { kind: "in-flight" };
  if (status === 409 && name === "invalid_idempotent_request") return { kind: "already-sent" };
  if (status === 429 && (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded")) {
    return { kind: "stop-tick", reason: "quota" };
  }
  if (status === 429) return { kind: "stop-tick", reason: "rate-limited" };
  if (status === 401 || status === 403) return { kind: "stop-tick", reason: "credential" };
  return { kind: "failed", status, name };
};

/** Resend's error `name` (a short code), never its message or anything else from the body. */
const errorName = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
    ? body.name
    : "unknown";
};
