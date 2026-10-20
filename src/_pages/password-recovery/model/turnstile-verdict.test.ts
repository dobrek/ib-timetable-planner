import { describe, expect, it } from "vitest";
import { TURNSTILE_ACTION, judgeSiteverify, preflightTurnstile } from "./turnstile-verdict";

const SECRET = "0x4AAAAAAA-real-looking-secret";
const PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";
const HOST = "ib-timetable-planner.dev";

describe("preflightTurnstile", () => {
  it("hands a token and a real secret on to siteverify", () => {
    expect(preflightTurnstile({ token: "tok", secret: SECRET, requestHost: HOST })).toEqual({
      token: "tok",
      secret: SECRET,
    });
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["over 2048 characters", "t".repeat(2049)],
    ["a file", new Blob(["tok"])],
  ])("refuses a %s token", (_label, token) => {
    expect(preflightTurnstile({ token, secret: SECRET, requestHost: HOST })).toBe("refused");
  });

  it("takes a token of exactly 2048 characters", () => {
    expect(preflightTurnstile({ token: "t".repeat(2048), secret: SECRET, requestHost: HOST })).not.toBe("refused");
  });

  it.each([undefined, ""])("is misconfigured with no secret (%j), even with no token", (secret) => {
    expect(preflightTurnstile({ token: null, secret, requestHost: HOST })).toBe("misconfigured");
  });

  it.each([
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
  ])("is misconfigured with the test secret %s on a public host", (secret) => {
    expect(preflightTurnstile({ token: "tok", secret, requestHost: HOST })).toBe("misconfigured");
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts a test secret on the loopback host %s", (requestHost) => {
    expect(preflightTurnstile({ token: "tok", secret: PASS_TEST_SECRET, requestHost })).toEqual({
      token: "tok",
      secret: PASS_TEST_SECRET,
    });
  });
});

describe("judgeSiteverify", () => {
  const judge = (status: number, body: unknown, requestHost = HOST) => judgeSiteverify(status, body, { requestHost });

  it("passes a success for this action on this host", () => {
    expect(judge(200, { success: true, action: TURNSTILE_ACTION, hostname: HOST, "error-codes": [] })).toBe("pass");
  });

  it("refuses a success minted for another action", () => {
    expect(judge(200, { success: true, action: "login", hostname: HOST })).toBe("refused");
  });

  it("refuses a success minted for another host", () => {
    expect(judge(200, { success: true, action: TURNSTILE_ACTION, hostname: "evil.example" })).toBe("refused");
  });

  it("refuses a spent or expired token, which is a 200", () => {
    expect(judge(200, { success: false, "error-codes": ["timeout-or-duplicate"] })).toBe("refused");
  });

  it("refuses a malformed token", () => {
    expect(judge(200, { success: false, "error-codes": ["invalid-input-response"] })).toBe("refused");
  });

  it.each(["invalid-input-secret", "missing-input-secret"])("is misconfigured on a 400 with %s", (code) => {
    expect(judge(400, { success: false, "error-codes": [code] })).toBe("misconfigured");
  });

  it("is transient on Cloudflare's own internal error", () => {
    expect(judge(200, { success: false, "error-codes": ["internal-error"] })).toBe("transient");
  });

  it.each([
    ["a 5xx", 503, { success: false }],
    ["a body that is not JSON", 502, undefined],
    ["a body with no success field", 200, { ok: true }],
    ["a body with garbled error codes", 200, { success: false, "error-codes": "nope" }],
    ["null", 200, null],
  ])("is transient on %s", (_label, status, body) => {
    expect(judge(status, body)).toBe("transient");
  });

  it("passes a test-key success on loopback, despite its example.com host and missing action", () => {
    const body = { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } };

    expect(judge(200, body, "localhost")).toBe("pass");
  });

  it("is misconfigured on a test-key success anywhere but loopback", () => {
    const body = { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } };

    expect(judge(200, body)).toBe("misconfigured");
  });
});
