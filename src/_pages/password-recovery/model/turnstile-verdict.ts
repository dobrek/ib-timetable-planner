/**
 * The Cloudflare Turnstile check in front of the public reset request, as pure rules. It fails
 * closed: only `pass` lets a request through.
 *
 * - `pass`: Cloudflare vouched for this token, for this action, on this host.
 * - `refused`: no token, a bad, spent or expired one, or one minted for another action or host.
 * - `transient`: Cloudflare could not be asked or could not answer. The visitor tries again.
 * - `misconfigured`: our side is wrong — no secret, a rejected one, or a test secret off loopback.
 *   Reset is then unavailable rather than unguarded.
 */
export type TurnstileVerdict = "pass" | "refused" | "transient" | "misconfigured";

/** The widget's `data-action`. Cloudflare echoes it back, so a token minted elsewhere is refused. */
export const TURNSTILE_ACTION = "forgot-password";

/** What siteverify needs, once the preflight has checked it. */
export type SiteverifyRequest = { token: string; secret: string };

/**
 * Decide what can be decided without calling Cloudflare: a verdict, or the checked token and
 * secret to send. A missing secret wins over a missing token — reset is unavailable either way.
 *
 * Cloudflare's three test secrets are accepted only on a loopback host. Anywhere else they count as
 * `misconfigured`, because the pass one vouches for any token: a test secret on production would
 * otherwise switch the check off without a sound.
 */
export function preflightTurnstile({
  token,
  secret,
  requestHost,
}: {
  token: unknown;
  secret: string | undefined;
  requestHost: string;
}): TurnstileVerdict | SiteverifyRequest {
  if (!secret) return "misconfigured";
  if (TEST_SECRETS.has(secret) && !isLoopback(requestHost)) return "misconfigured";
  if (typeof token !== "string" || token === "" || token.length > MAX_TOKEN_LENGTH) return "refused";
  return { token, secret };
}

/**
 * Judge one siteverify answer. Branches on `success`, never on the status alone: a bad or replayed
 * token is HTTP 200 with `success: false`.
 *
 * A test secret's pass carries `metadata.result_with_testing_key`, `hostname: "example.com"` and no
 * `action`, so it is the one pass that skips the action and host checks — and only on loopback.
 */
export function judgeSiteverify(
  status: number,
  body: unknown,
  { requestHost }: { requestHost: string },
): TurnstileVerdict {
  if (!isSiteverifyBody(body)) return "transient";
  const errorCodes = body["error-codes"] ?? [];
  if (errorCodes.some((code) => SECRET_ERRORS.has(code))) return "misconfigured";
  if (status >= 500 || errorCodes.includes("internal-error")) return "transient";
  if (body.success !== true) return "refused";
  if (body.metadata?.result_with_testing_key === true) return isLoopback(requestHost) ? "pass" : "misconfigured";
  return body.action === TURNSTILE_ACTION && body.hostname === requestHost ? "pass" : "refused";
}

// Turnstile tokens are at most 2048 characters (Cloudflare's server-side validation docs).
const MAX_TOKEN_LENGTH = 2048;

// Cloudflare's published test secrets: always passes, always fails, always "already spent".
const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const SECRET_ERRORS = new Set(["missing-input-secret", "invalid-input-secret"]);

// `URL.hostname` keeps the brackets on an IPv6 literal.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLoopback = (host: string): boolean => LOOPBACK_HOSTS.has(host);

type SiteverifyBody = {
  success?: unknown;
  "error-codes"?: string[];
  action?: unknown;
  hostname?: unknown;
  metadata?: { result_with_testing_key?: unknown };
};

const isSiteverifyBody = (body: unknown): body is SiteverifyBody =>
  typeof body === "object" &&
  body !== null &&
  "success" in body &&
  (!("error-codes" in body) ||
    (Array.isArray(body["error-codes"]) && body["error-codes"].every((code) => typeof code === "string")));
