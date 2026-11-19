import { isLoopbackHost } from "@/shared/config";
import {
  globalFetch,
  NO_ANSWER,
  SEND_TIMEOUT_MS,
  type FetchLike,
  type MailSender,
  type MailTransport,
} from "./mail-transport";

export type MailpitTransportOptions = {
  /** Mailpit's web and API address, e.g. `http://127.0.0.1:54324`. Must name a loopback host. */
  url: string;
  from: MailSender;
  fetch?: FetchLike;
  timeoutMs?: number;
};

/**
 * Send through the local stack's Mailpit (`POST /api/v1/send`), for local runs and CI, where Resend
 * must never be called. Mailpit keeps the message for a test or a person to read; it delivers nothing.
 *
 * **Loopback only, refused at construction.** A test transport must never be reachable off this
 * machine, the rule Turnstile's test keys follow, so a non-loopback URL throws here rather than
 * sending anywhere.
 *
 * Mailpit has no idempotency key: the sweep's claim is what keeps two runs from sending twice.
 */
export function createMailpitTransport({
  url,
  from,
  fetch = globalFetch,
  timeoutMs = SEND_TIMEOUT_MS,
}: MailpitTransportOptions): MailTransport {
  const base = new URL(url);
  if (!isLoopbackHost(base.hostname)) {
    throw new Error(`Mailpit transport: refusing non-loopback host "${base.hostname}"`);
  }
  const endpoint = new URL("/api/v1/send", base).toString();

  return {
    send: async (message) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: from.address, Name: from.name },
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);
      if (response === null) return NO_ANSWER;
      return response.ok ? { kind: "sent" } : { kind: "failed", status: response.status, name: "mailpit" };
    },
  };
}
