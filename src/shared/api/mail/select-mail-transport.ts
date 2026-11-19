import { isLoopbackHost } from "@/shared/config";
import type { FetchLike, MailSender, MailTransport } from "./mail-transport";
import { createMailpitTransport } from "./mailpit-transport";
import { createResendTransport } from "./resend-transport";

/** Which transport to build, once the keys have been checked. */
export type MailTransportChoice = { kind: "resend"; apiKey: string } | { kind: "mailpit"; url: string };

/** Why no transport could be chosen. */
export type MailTransportProblem = "none-set" | "both-set" | "mailpit-not-loopback";

export type MailTransportKeys = { RESEND_API_KEY?: string; MAILPIT_URL?: string };

/**
 * The transport the keys name, by explicit configuration and never by sniffing the host: Resend when
 * only `RESEND_API_KEY` is set, Mailpit when only `MAILPIT_URL` is. Neither, or both, is a problem,
 * never a silent pick. A blank value counts as unset. A `MAILPIT_URL` off loopback is refused here as
 * well as at construction, so the job-email config reader (which shares this rule) never reports a
 * configuration the transport would then refuse.
 */
export function chooseMailTransport(
  keys: MailTransportKeys,
): { ok: true; choice: MailTransportChoice } | { ok: false; problem: MailTransportProblem } {
  const apiKey = present(keys.RESEND_API_KEY);
  const url = present(keys.MAILPIT_URL);
  if (apiKey !== undefined && url !== undefined) return { ok: false, problem: "both-set" };
  if (apiKey !== undefined) return { ok: true, choice: { kind: "resend", apiKey } };
  if (url === undefined) return { ok: false, problem: "none-set" };
  return isLoopbackUrl(url)
    ? { ok: true, choice: { kind: "mailpit", url } }
    : { ok: false, problem: "mailpit-not-loopback" };
}

/** Build the chosen transport. */
export function createMailTransport(
  choice: MailTransportChoice,
  options: { from: MailSender; fetch?: FetchLike },
): MailTransport {
  return choice.kind === "resend"
    ? createResendTransport({ apiKey: choice.apiKey, ...options })
    : createMailpitTransport({ url: choice.url, ...options });
}

/** The transport the keys name, or null when they name none, or both. */
export function selectMailTransport(
  keys: MailTransportKeys,
  options: { from: MailSender; fetch?: FetchLike },
): MailTransport | null {
  const chosen = chooseMailTransport(keys);
  return chosen.ok ? createMailTransport(chosen.choice, options) : null;
}

const present = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed === "" ? undefined : trimmed;
};

const isLoopbackUrl = (raw: string): boolean => {
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
};
