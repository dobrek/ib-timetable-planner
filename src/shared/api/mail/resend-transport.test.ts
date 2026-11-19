import { describe, expect, it, vi } from "vitest";
import type { FetchLike, OutgoingMail } from "./mail-transport";
import { createResendTransport } from "./resend-transport";
import { firstCall } from "./fetch-calls.test-support";

const from = { name: "IB Planner", address: "team@ib-timetable-planner.dev" };

const message: OutgoingMail = {
  to: "author@example.test",
  subject: "IB Planner: generation finished for “Plan”",
  text: "text body",
  html: "<p>html body</p>",
  idempotencyKey: "job-email/11111111-1111-4111-8111-111111111111",
};

const answering = (status: number, body: unknown = {}) =>
  vi.fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

const send = (fetch: FetchLike) => createResendTransport({ apiKey: "re_test_key", from, fetch }).send(message);

describe("createResendTransport", () => {
  it("POSTs the message to /emails with the key, the idempotency key and a User-Agent", async () => {
    const fetch = answering(200, { id: "email-id" });

    await expect(send(fetch)).resolves.toEqual({ kind: "sent" });

    const { url, init, body } = firstCall(fetch);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer re_test_key");
    expect(headers.get("Idempotency-Key")).toBe(message.idempotencyKey);
    expect(headers.get("User-Agent")).toMatch(/\S/);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(body).toEqual({
      from: "IB Planner <team@ib-timetable-planner.dev>",
      to: ["author@example.test"],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [409, "concurrent_idempotent_requests", { kind: "in-flight" }],
    [409, "invalid_idempotent_request", { kind: "already-sent" }],
    [429, "daily_quota_exceeded", { kind: "stop-tick", reason: "quota" }],
    [429, "monthly_quota_exceeded", { kind: "stop-tick", reason: "quota" }],
    [429, "rate_limit_exceeded", { kind: "stop-tick", reason: "rate-limited" }],
    [401, "missing_api_key", { kind: "stop-tick", reason: "credential" }],
    [403, "invalid_api_key", { kind: "stop-tick", reason: "credential" }],
    [403, "validation_error", { kind: "stop-tick", reason: "credential" }],
    [422, "validation_error", { kind: "failed", status: 422, name: "validation_error" }],
    [500, "application_error", { kind: "failed", status: 500, name: "application_error" }],
  ] as const)("classifies %i %s", async (status, name, outcome) => {
    await expect(send(answering(status, { statusCode: status, name, message: "for a person" }))).resolves.toEqual(
      outcome,
    );
  });

  it("keeps only the error name, never the body's message, and copes with a body that is not JSON", async () => {
    const leaky = answering(500, { name: "application_error", message: "author@example.test is broken" });
    expect(JSON.stringify(await send(leaky))).not.toContain("author@example.test");

    const html = vi.fn<FetchLike>(() => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(send(html)).resolves.toEqual({ kind: "failed", status: 502, name: "unknown" });
  });

  it("reports no answer, rather than throwing, when the request never completes", async () => {
    const down = vi.fn<FetchLike>(() => Promise.reject(new TypeError("network connection lost")));

    await expect(send(down)).resolves.toEqual({ kind: "failed", status: 0, name: "no-answer" });
  });
});
