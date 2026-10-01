import { parse as parseDevalue } from "devalue";

/**
 * The campaign runner's way into the deployed app: no browser, the app's own endpoints only.
 *
 * Every write the campaign makes goes through an Astro Action (`lessons.md`: "Astro Actions are the
 * single transport"), so the guards, the compare-and-sets and the delivery pipeline are the same ones
 * an author's click runs. The only non-action calls are the sign-in route and the operator's
 * `/api/solver/container`, both of which are API routes for a non-Astro consumer by design.
 *
 * Contract, as Astro 7 and the app implement it (verified against `node_modules/astro` 7.3):
 *
 * - **Sign-in** is a form POST to `/api/auth/signin`. Astro's `checkOrigin` refuses a form POST
 *   without a matching `Origin`, so it is sent. The route always redirects; success is judged from
 *   the `Location` (`/dashboard`), never the status.
 * - **Cookies** live in memory only and every `Set-Cookie` is applied: the middleware's `getUser()`
 *   may rotate the session on any request, the Supabase cookie is chunked (`.0`, `.1`) above ~3 KB, and
 *   a shrinking session deletes its stale chunk with `Max-Age=0`. Nothing is written to disk — the
 *   runner signs in on every start.
 * - **Actions** are JSON POSTs to `/_actions/<name>`. 200 is `application/json+devalue`, 204 is a void
 *   action, anything else is a JSON error carrying `code`. Actions never redirect (`/_` is a public
 *   prefix, so `requireSession` throws `UNAUTHORIZED` instead), and that code means "session lost":
 *   sign in again, once.
 */
export type CookieJar = ReadonlyMap<string, string>;

/** An action's error, by the code Astro gave it. `status` is the HTTP status it travelled with. */
export class ActionCallError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ActionCallError";
    this.code = code;
    this.status = status;
  }
}

/** A plain HTTP failure outside the action protocol — the sign-in route or the operator route. */
export class HttpCallError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpCallError";
    this.status = status;
  }
}

export type AppClientOptions = {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
  readonly fetch?: typeof fetch;
};

export type AppClient = {
  signIn(): Promise<void>;
  action<T>(name: string, input: unknown, options?: { readonly timeoutMs?: number }): Promise<T>;
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  getText(path: string): Promise<string>;
};

/** Long enough for `startGeneration`'s cold start: 45 s container start + 15 s dispatch, with margin. */
export const DISPATCH_TIMEOUT_MS = 120_000;

const DEFAULT_TIMEOUT_MS = 30_000;

export const createAppClient = (options: AppClientOptions): AppClient => {
  const fetchImpl = options.fetch ?? fetch;
  const origin = new URL(options.baseUrl).origin;
  const state: { jar: CookieJar } = { jar: new Map() };

  const send = async (path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> => {
    const response = await fetchImpl(new URL(path, origin), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader(state.jar) },
    });
    state.jar = applySetCookies(state.jar, response.headers.getSetCookie(), Date.now());
    return response;
  };

  const signIn = async (): Promise<void> => {
    const response = await send("/api/auth/signin", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: options.email, password: options.password }).toString(),
    });
    const location = response.headers.get("location");
    if (!signedIn(location)) {
      throw new HttpCallError(
        response.status,
        `sign-in refused: ${signInError(location) ?? `HTTP ${response.status}`}`,
      );
    }
  };

  /** One re-sign-in on a lost session, then the call again; a second loss is an error. */
  const withSession = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (!isSessionLost(error)) throw error;
      await signIn();
      return call();
    }
  };

  const action = <T>(name: string, input: unknown, { timeoutMs }: { readonly timeoutMs?: number } = {}): Promise<T> =>
    withSession(async () => {
      const response = await send(
        `/_actions/${name}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
        timeoutMs,
      );
      // The caller names the action's output type; the wire carries no schema to check it against.
      return decodeActionResponse(response.status, response.headers.get("content-type"), await response.text()) as T;
    });

  const route = (path: string, init: RequestInit): Promise<Response> =>
    withSession(async () => {
      const response = await send(path, init);
      if (isRedirectToSignIn(response)) throw new HttpCallError(401, "session lost");
      if (!response.ok)
        throw new HttpCallError(response.status, `${path} answered ${response.status}: ${await response.text()}`);
      return response;
    });

  return {
    signIn,
    action,
    getJson: async <T>(path: string) => (await (await route(path, { method: "GET" })).json()) as T,
    postJson: async <T>(path: string, body: unknown) =>
      (await (
        await route(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json()) as T,
    getText: async (path: string) => (await route(path, { method: "GET" })).text(),
  };
};

/**
 * Every `Set-Cookie` applied to the jar: a value replaces, and `Max-Age=0` (or an `Expires` already
 * past) deletes — which is how a shrinking Supabase session drops its stale `.1` chunk.
 */
export const applySetCookies = (jar: CookieJar, headers: readonly string[], nowMs: number): Map<string, string> =>
  headers.map(parseSetCookie).reduce((next, cookie) => {
    if (cookie === null) return next;
    const updated = new Map(next);
    if (cookie.expired(nowMs)) updated.delete(cookie.name);
    else updated.set(cookie.name, cookie.value);
    return updated;
  }, new Map(jar));

export const cookieHeader = (jar: CookieJar): string => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** The sign-in route's verdict, read from where it redirects. */
export const signedIn = (location: string | null): boolean =>
  location !== null && new URL(location, "http://x").pathname === "/dashboard";

/** An action response as its value, or the typed error its body names. */
export const decodeActionResponse = (status: number, contentType: string | null, body: string): unknown => {
  if (status === 204) return undefined;
  if (status === 200 && (contentType ?? "").startsWith("application/json+devalue")) {
    return parseDevalue(body, { URL: (href: string) => new URL(href) });
  }
  throw toActionError(status, body);
};

export const toActionError = (status: number, body: string): ActionCallError => {
  const parsed = safeJson(body);
  const code =
    typeof parsed?.code === "string"
      ? parsed.code
      : parsed?.type === "AstroActionInputError"
        ? "BAD_REQUEST"
        : "UNKNOWN";
  const message = typeof parsed?.message === "string" ? parsed.message : body.slice(0, 300);
  return new ActionCallError(code, status, message);
};

/** Transient by nature: the network, a 5xx, a timeout. A 4xx is an answer and is never retried. */
export const isTransient = (error: unknown): boolean => {
  if (error instanceof ActionCallError || error instanceof HttpCallError) return error.status >= 500;
  return error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
};

// --- helpers --------------------------------------------------------------------------------------

type ParsedCookie = { readonly name: string; readonly value: string; readonly expired: (nowMs: number) => boolean };

const parseSetCookie = (header: string): ParsedCookie | null => {
  const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const attribute = (key: string): string | undefined =>
    attributes
      .map((entry) => entry.split("="))
      .find(([name]) => name.trim().toLowerCase() === key)?.[1]
      ?.trim();
  const maxAge = attribute("max-age");
  const expires = attribute("expires");
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    expired: (nowMs) =>
      (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) <= nowMs),
  };
};

const signInError = (location: string | null): string | null =>
  location === null ? null : new URL(location, "http://x").searchParams.get("error");

const isRedirectToSignIn = (response: Response): boolean =>
  response.status >= 300 &&
  response.status < 400 &&
  new URL(response.headers.get("location") ?? "/", "http://x").pathname === "/auth/signin";

const isSessionLost = (error: unknown): boolean =>
  (error instanceof ActionCallError && error.code === "UNAUTHORIZED") ||
  (error instanceof HttpCallError && error.status === 401);

const safeJson = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
