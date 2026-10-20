import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { formatResetReport, toResetReport } from "./reset-outcome";

/** Each row with the error supabase-js itself constructs for that `/recover` response. No network. */
describe("toResetReport", () => {
  it("is accepted when there is no error", () => {
    expect(toResetReport(null)).toEqual({ outcome: "accepted", code: null, status: null });
  });

  it.each([
    ["the per-user resend interval", new AuthApiError("…", 429, "over_email_send_rate_limit"), "throttled"],
    ["the per-IP limiter", new AuthApiError("…", 429, "over_request_rate_limit"), "throttled"],
    ["an invalid address", new AuthApiError("…", 400, "email_address_invalid"), "rejected-address"],
    ["a malformed request", new AuthApiError("…", 400, "validation_failed"), "rejected-address"],
    ["an address the mailer refuses", new AuthApiError("…", 400, "email_address_not_authorized"), "rejected-address"],
    ["a CAPTCHA turned on in Supabase", new AuthApiError("…", 400, "captcha_failed"), "unexpected"],
    ["a code this list does not know", new AuthApiError("…", 400, "something_new"), "unexpected"],
  ] as const)("classifies %s", (_label, error, outcome) => {
    expect(toResetReport(error)).toEqual({ outcome, code: error.code, status: error.status });
  });

  it("is send-failed on a GoTrue 5xx, which arrives with no code", () => {
    const error = new AuthRetryableFetchError("Error sending recovery email", 500);

    expect(toResetReport(error)).toEqual({ outcome: "send-failed", code: null, status: 500 });
  });

  it("is send-failed when GoTrue is unreachable", () => {
    const error = new AuthRetryableFetchError("fetch failed", 0);

    expect(toResetReport(error)).toEqual({ outcome: "send-failed", code: null, status: 0 });
  });

  it("is unexpected on an unparseable response", () => {
    expect(toResetReport(new AuthUnknownError("bad json", null)).outcome).toBe("unexpected");
  });

  it.each([new TypeError("fetch failed"), "a string", { code: "over_request_rate_limit" }])(
    "is unexpected, without throwing, on a thrown value that is not an Auth error: %j",
    (thrown) => {
      expect(toResetReport(thrown)).toEqual({ outcome: "unexpected", code: null, status: null });
    },
  );
});

describe("formatResetReport", () => {
  it("names the outcome, code and status under the fixed prefix", () => {
    expect(formatResetReport({ outcome: "throttled", code: "over_email_send_rate_limit", status: 429 })).toBe(
      "[forgot-password] outcome=throttled code=over_email_send_rate_limit status=429",
    );
  });

  it("marks a missing code or status", () => {
    expect(formatResetReport({ outcome: "accepted", code: null, status: null })).toBe(
      "[forgot-password] outcome=accepted code=- status=-",
    );
  });
});
