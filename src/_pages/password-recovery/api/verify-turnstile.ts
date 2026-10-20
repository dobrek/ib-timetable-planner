import { judgeSiteverify, preflightTurnstile, type TurnstileVerdict } from "../model/turnstile-verdict";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token with Cloudflare: the preflight, then ONE form-encoded siteverify POST
 * bounded by `timeoutMs`, then the verdict. A timeout or network failure is `transient`; there is
 * no retry — the visitor resubmits with a fresh widget token, since a token is single-use anyway.
 *
 * `fetch` is injectable for the unit test. The default wraps the global rather than aliasing it:
 * workerd refuses a `fetch` called with a `this` other than the global.
 */
export async function verifyTurnstile({
  token,
  secret,
  remoteIp,
  requestHost,
  fetch: send = (input, init) => fetch(input, init),
  timeoutMs = 5_000,
}: {
  token: unknown;
  secret: string | undefined;
  remoteIp: string | undefined;
  requestHost: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnstileVerdict> {
  const checked = preflightTurnstile({ token, secret, requestHost });
  if (typeof checked === "string") return checked;

  const body = new URLSearchParams({ secret: checked.secret, response: checked.token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await send(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(timeoutMs) });
    return judgeSiteverify(response.status, await readJson(response), { requestHost });
  } catch {
    return "transient";
  }
}

const readJson = (response: Response): Promise<unknown> => response.json().catch(() => undefined);
