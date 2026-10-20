import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import type { EmailLink } from "../model/email-link";
import { verifyEmailLink } from "./verify-email-link";

const LINK: EmailLink = { tokenHash: "a".repeat(56), type: "recovery" };

/** A client whose only Auth call is the one under test, and that call's spy. */
const clientResolving = (result: () => Promise<unknown>) => {
  const verifyOtp = vi.fn(result);
  return { client: { auth: { verifyOtp } } as unknown as SupabaseClient, verifyOtp };
};

const clientReturning = (error: unknown) => clientResolving(() => Promise.resolve({ data: {}, error })).client;

describe("verifyEmailLink", () => {
  it("sends exactly the hash and the type", async () => {
    const { client, verifyOtp } = clientResolving(() => Promise.resolve({ data: {}, error: null }));

    await verifyEmailLink(client, LINK);

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: LINK.tokenHash, type: "recovery" });
  });

  it("is ok when GoTrue accepts the link", async () => {
    expect(await verifyEmailLink(clientReturning(null), LINK)).toEqual({ ok: true });
  });

  it.each([
    [
      "used, replaced, expired or unknown",
      new AuthApiError("Email link is invalid or has expired", 403, "otp_expired"),
    ],
    ["a banned user", new AuthApiError("User is banned", 403, "user_banned")],
    ["a code this list does not know", new AuthApiError("…", 400, "something_new")],
  ])("is expired when the link is %s", async (_label, error) => {
    expect(await verifyEmailLink(clientReturning(error), LINK)).toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    ["the per-IP limiter", new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")],
    ["a GoTrue 5xx", new AuthRetryableFetchError("Bad Gateway", 502)],
    ["an unreachable GoTrue", new AuthRetryableFetchError("fetch failed", 0)],
  ])("asks for a retry on %s", async (_label, error) => {
    expect(await verifyEmailLink(clientReturning(error), LINK)).toEqual({ ok: false, reason: "retry" });
  });

  it("asks for a retry, without throwing, when the client throws", async () => {
    const { client } = clientResolving(() => Promise.reject(new TypeError("fetch failed")));

    expect(await verifyEmailLink(client, LINK)).toEqual({ ok: false, reason: "retry" });
  });
});
