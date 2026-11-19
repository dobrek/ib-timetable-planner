import { describe, expect, it, vi } from "vitest";
import type { FetchLike, OutgoingMail } from "./mail-transport";
import { createMailpitTransport } from "./mailpit-transport";
import { firstCall } from "./fetch-calls.test-support";

const from = { name: "IB Planner", address: "team@ib-timetable-planner.dev" };

const message: OutgoingMail = {
  to: "author@example.test",
  subject: "subject",
  text: "text body",
  html: "<p>html body</p>",
  idempotencyKey: "job-email/id",
};

describe("createMailpitTransport", () => {
  it("POSTs Mailpit's send shape to /api/v1/send on the given loopback URL", async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(JSON.stringify({ ID: "abc" }), { status: 200 })));

    await expect(createMailpitTransport({ url: "http://127.0.0.1:54324", from, fetch }).send(message)).resolves.toEqual(
      {
        kind: "sent",
      },
    );

    const { url, body } = firstCall(fetch);
    expect(url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(body).toEqual({
      From: { Email: "team@ib-timetable-planner.dev", Name: "IB Planner" },
      To: [{ Email: "author@example.test" }],
      Subject: "subject",
      Text: "text body",
      HTML: "<p>html body</p>",
    });
  });

  it.each(["https://mailpit.example.test", "http://10.0.0.5:54324", "http://host.docker.internal:54324"])(
    "refuses a non-loopback URL at construction: %s",
    (url) => {
      expect(() => createMailpitTransport({ url, from })).toThrow(/non-loopback/);
    },
  );

  it("reports a refusal as a failure, and no answer without throwing", async () => {
    const refused = vi.fn<FetchLike>(() => Promise.resolve(new Response("nope", { status: 400 })));
    await expect(
      createMailpitTransport({ url: "http://localhost:54324", from, fetch: refused }).send(message),
    ).resolves.toEqual({ kind: "failed", status: 400, name: "mailpit" });

    const down = vi.fn<FetchLike>(() => Promise.reject(new TypeError("connection refused")));
    await expect(
      createMailpitTransport({ url: "http://localhost:54324", from, fetch: down }).send(message),
    ).resolves.toEqual({
      kind: "failed",
      status: 0,
      name: "no-answer",
    });
  });
});
