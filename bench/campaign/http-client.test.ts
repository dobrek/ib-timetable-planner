import { stringify } from "devalue";
import { describe, expect, it, vi } from "vitest";
import {
  ActionCallError,
  applySetCookies,
  cookieHeader,
  createAppClient,
  decodeActionResponse,
  isTransient,
  signedIn,
  toActionError,
} from "./http-client.ts";

/**
 * The runner's whole view of production goes through this client, so the parts that are easy to get
 * subtly wrong are pinned: chunked and deleted cookies, the action wire format, the error codes, and
 * the one re-sign-in on a lost session.
 */
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

describe("the cookie jar", () => {
  it("keeps every cookie a response sets, chunked session cookies included", () => {
    const jar = applySetCookies(
      new Map(),
      [
        "sb-ref-auth-token.0=base64-AAA; Path=/; HttpOnly; SameSite=Lax",
        "sb-ref-auth-token.1=BBB; Path=/; HttpOnly; Max-Age=34560000",
      ],
      NOW,
    );

    expect(cookieHeader(jar)).toBe("sb-ref-auth-token.0=base64-AAA; sb-ref-auth-token.1=BBB");
  });

  it("deletes a chunk the server expires with Max-Age=0 or a past Expires — a shrinking session", () => {
    const before = new Map([
      ["sb-ref-auth-token.0", "base64-AAA"],
      ["sb-ref-auth-token.1", "BBB"],
      ["other", "x"],
    ]);

    const after = applySetCookies(
      before,
      [
        "sb-ref-auth-token.1=; Path=/; Max-Age=0",
        "other=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "sb-ref-auth-token.0=base64-CCC; Path=/",
      ],
      NOW,
    );

    expect([...after]).toEqual([["sb-ref-auth-token.0", "base64-CCC"]]);
    expect(before.size).toBe(3);
  });

  it("keeps a value that contains '='", () => {
    expect(applySetCookies(new Map(), ["token=a=b==; Path=/"], NOW).get("token")).toBe("a=b==");
  });
});

describe("signedIn", () => {
  it("reads success from where the sign-in route redirects, not from its status", () => {
    expect(signedIn("/dashboard")).toBe(true);
    expect(signedIn("https://app.example/dashboard")).toBe(true);
    expect(signedIn("/auth/signin?error=Invalid%20login%20credentials")).toBe(false);
    expect(signedIn(null)).toBe(false);
  });
});

describe("decodeActionResponse", () => {
  it("decodes a 200 devalue body and reads a 204 as nothing", () => {
    expect(decodeActionResponse(200, "application/json+devalue", stringify({ jobId: "j", list: [1, 2] }))).toEqual({
      jobId: "j",
      list: [1, 2],
    });
    expect(decodeActionResponse(204, null, "")).toBeUndefined();
  });

  it("throws the action error by its code", () => {
    const body = JSON.stringify({
      type: "AstroActionError",
      code: "CONFLICT",
      status: 409,
      message: "already running",
    });

    expect(() => decodeActionResponse(409, "application/json", body)).toThrow(ActionCallError);
    expect(toActionError(409, body)).toMatchObject({ code: "CONFLICT", status: 409, message: "already running" });
  });

  it("maps an input-validation failure to BAD_REQUEST and an unreadable body to UNKNOWN", () => {
    expect(toActionError(400, JSON.stringify({ type: "AstroActionInputError", issues: [] })).code).toBe("BAD_REQUEST");
    expect(toActionError(502, "<html>Bad gateway</html>")).toMatchObject({ code: "UNKNOWN", status: 502 });
  });
});

describe("isTransient", () => {
  it("retries the network and 5xx, never a 4xx answer", () => {
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new ActionCallError("INTERNAL_SERVER_ERROR", 500, "boom"))).toBe(true);
    expect(isTransient(new ActionCallError("CONFLICT", 409, "busy"))).toBe(false);
    expect(isTransient(new ActionCallError("UNAUTHORIZED", 401, "signed out"))).toBe(false);
  });
});

describe("createAppClient", () => {
  const signInOk = (): Response =>
    new Response(null, { status: 302, headers: { location: "/dashboard", "set-cookie": "sb-auth.0=token; Path=/" } });
  const unauthorized = (): Response =>
    new Response(JSON.stringify({ type: "AstroActionError", code: "UNAUTHORIZED", status: 401, message: "sign in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  const devalue = (value: unknown): Response =>
    new Response(stringify(value), { status: 200, headers: { "content-type": "application/json+devalue" } });

  it("signs in with a form POST carrying the Origin, and sends the session cookie on the next call", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(signInOk())
      .mockResolvedValueOnce(devalue({ id: "p" }));
    const client = createAppClient({ baseUrl: "https://app.example/", email: "e", password: "p", fetch: fetchMock });

    await client.signIn();
    const result = await client.action<{ id: string }>("clonePlan", { sourcePlanId: "s" });

    expect(result).toEqual({ id: "p" });
    const [signInUrl, signInInit] = fetchMock.mock.calls[0] ?? [];
    expect(signInUrl).toEqual(new URL("https://app.example/api/auth/signin"));
    expect(signInInit?.headers).toMatchObject({ origin: "https://app.example" });
    expect(signInInit?.redirect).toBe("manual");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ cookie: "sb-auth.0=token" });
  });

  it("signs in again once when an action reports the session lost, then repeats the call", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(signInOk())
      .mockResolvedValueOnce(devalue(null));
    const client = createAppClient({ baseUrl: "https://app.example", email: "e", password: "p", fetch: fetchMock });

    await expect(client.action("checkPlan", { planId: "x" })).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up when the session is lost a second time", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(signInOk())
      .mockResolvedValueOnce(unauthorized());
    const client = createAppClient({ baseUrl: "https://app.example", email: "e", password: "p", fetch: fetchMock });

    await expect(client.action("checkPlan", { planId: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reports a refused sign-in with the route's own error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/auth/signin?error=Invalid%20login" } }),
      );
    const client = createAppClient({ baseUrl: "https://app.example", email: "e", password: "p", fetch: fetchMock });

    await expect(client.signIn()).rejects.toThrow("sign-in refused: Invalid login");
  });
});
