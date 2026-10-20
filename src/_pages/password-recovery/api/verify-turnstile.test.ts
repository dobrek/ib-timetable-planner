import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_ACTION } from "../model/turnstile-verdict";
import { verifyTurnstile } from "./verify-turnstile";

const HOST = "ib-timetable-planner.dev";
const SECRET = "0x4AAAAAAA-real-looking-secret";

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));

const verify = (send: typeof fetch, overrides: { token?: unknown; secret?: string; timeoutMs?: number } = {}) =>
  verifyTurnstile({
    token: "tok",
    secret: SECRET,
    remoteIp: "203.0.113.7",
    requestHost: HOST,
    fetch: send,
    ...overrides,
  });

describe("verifyTurnstile", () => {
  it("posts one form-encoded body with the secret, the token and the visitor's address", async () => {
    const send = answering(200, { success: true, action: TURNSTILE_ACTION, hostname: HOST });

    expect(await verify(send)).toBe("pass");

    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init?.method).toBe("POST");
    const body = init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body as URLSearchParams)).toEqual({
      secret: SECRET,
      response: "tok",
      remoteip: "203.0.113.7",
    });
  });

  it("leaves remoteip out when the address is unknown", async () => {
    const send = answering(200, { success: true, action: TURNSTILE_ACTION, hostname: HOST });

    await verifyTurnstile({ token: "tok", secret: SECRET, remoteIp: undefined, requestHost: HOST, fetch: send });

    const body = send.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });

  it("decides without calling Cloudflare when the preflight can", async () => {
    const send = answering(200, { success: true });

    expect(await verify(send, { token: null })).toBe("refused");
    expect(await verify(send, { secret: "" })).toBe("misconfigured");
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses what siteverify refuses", async () => {
    expect(await verify(answering(200, { success: false, "error-codes": ["timeout-or-duplicate"] }))).toBe("refused");
  });

  it("is transient when siteverify answers something that is not JSON", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 })));

    expect(await verify(send)).toBe("transient");
  });

  it("is transient when the request fails", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("network down")));

    expect(await verify(send)).toBe("transient");
  });

  it("is transient when Cloudflare does not answer in time", async () => {
    const send = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timed out", "TimeoutError"));
          });
        }),
    );

    expect(await verify(send, { timeoutMs: 10 })).toBe("transient");
  });
});
