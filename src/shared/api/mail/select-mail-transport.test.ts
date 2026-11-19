import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./mail-transport";
import { chooseMailTransport, createMailTransport } from "./select-mail-transport";

const from = { name: "IB Planner", address: "team@ib-timetable-planner.dev" };

describe("chooseMailTransport", () => {
  it("chooses Resend when only its key is set, and Mailpit when only its URL is", () => {
    expect(chooseMailTransport({ RESEND_API_KEY: "re_key" })).toEqual({
      ok: true,
      choice: { kind: "resend", apiKey: "re_key" },
    });
    expect(chooseMailTransport({ MAILPIT_URL: "http://127.0.0.1:54324" })).toEqual({
      ok: true,
      choice: { kind: "mailpit", url: "http://127.0.0.1:54324" },
    });
  });

  it("refuses neither, and both, rather than picking one", () => {
    expect(chooseMailTransport({})).toEqual({ ok: false, problem: "none-set" });
    expect(chooseMailTransport({ RESEND_API_KEY: " ", MAILPIT_URL: "" })).toEqual({ ok: false, problem: "none-set" });
    expect(chooseMailTransport({ RESEND_API_KEY: "re_key", MAILPIT_URL: "http://127.0.0.1:54324" })).toEqual({
      ok: false,
      problem: "both-set",
    });
  });

  it("refuses a Mailpit URL off loopback, or one that is not a URL", () => {
    for (const url of ["https://mailpit.example.test", "not a url"]) {
      expect(chooseMailTransport({ MAILPIT_URL: url }), url).toEqual({ ok: false, problem: "mailpit-not-loopback" });
    }
  });
});

describe("createMailTransport", () => {
  it("builds the chosen transport, which sends where that transport sends", async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response("{}", { status: 200 })));
    const message = { to: "a@example.test", subject: "s", text: "t", html: "h", idempotencyKey: "k" };

    await createMailTransport({ kind: "resend", apiKey: "re_key" }, { from, fetch }).send(message);
    await createMailTransport({ kind: "mailpit", url: "http://127.0.0.1:54324" }, { from, fetch }).send(message);

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.resend.com/emails",
      "http://127.0.0.1:54324/api/v1/send",
    ]);
  });
});
