/**
 * The port every outgoing app email goes through (S-310): one `send`, and an outcome the caller can
 * act on without ever seeing the provider's answer. Two adapters implement it: Resend's HTTP API in
 * production, and Mailpit's send API locally and in CI, where Resend must never be called.
 *
 * An adapter never throws for a provider's refusal or a network failure, and never logs or returns
 * an address or a response body: the outcome carries a status and the provider's short error `name`
 * at most.
 */
export type MailTransport = {
  send: (message: OutgoingMail) => Promise<SendOutcome>;
};

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * The same key for every attempt at the same email. Resend stores a successful send under it for
   * 24 hours and answers a repeat without sending again. Mailpit ignores it.
   */
  idempotencyKey: string;
};

/**
 * - `sent`: the provider accepted it.
 * - `already-sent`: an earlier attempt with this key was accepted. Resend stores only successes, so
 *   this is a send, not a failure.
 * - `in-flight`: another attempt with this key is still running; try again later.
 * - `stop-tick`: every message would fail alike for now (a quota, the rate limit, or a refused key or
 *   domain), so the caller stops sending until its next run.
 * - `failed`: this message failed; `status` is 0 when no answer came back.
 */
export type SendOutcome =
  | { kind: "sent" }
  | { kind: "already-sent" }
  | { kind: "in-flight" }
  | { kind: "stop-tick"; reason: "quota" | "rate-limited" | "credential" }
  | { kind: "failed"; status: number; name: string };

/** Who an email is from: a display name and an address on a verified sending domain. */
export type MailSender = { name: string; address: string };

/**
 * A `fetch` the adapters can be handed in tests. The default calls the global rather than aliasing
 * it: workerd refuses a `fetch` called with a `this` other than the global.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const globalFetch: FetchLike = (input, init) => fetch(input, init);

/** How long one send may take: well inside a cron run, and short enough to leave the claim to expire. */
export const SEND_TIMEOUT_MS = 10_000;

/** The outcome for a request that never got an answer: a timeout, a refused connection. */
export const NO_ANSWER: SendOutcome = { kind: "failed", status: 0, name: "no-answer" };
