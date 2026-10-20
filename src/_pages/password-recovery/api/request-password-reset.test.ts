import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { requestPasswordReset } from "./request-password-reset";

/** A client whose only Auth call is the one under test, and that call's spy. */
const clientResolving = (result: () => Promise<unknown>) => {
  const resetPasswordForEmail = vi.fn(result);
  return { client: { auth: { resetPasswordForEmail } } as unknown as SupabaseClient, resetPasswordForEmail };
};

const clientReturning = (error: unknown) => clientResolving(() => Promise.resolve({ data: null, error })).client;

describe("requestPasswordReset", () => {
  it("sends only the address, with no redirectTo", async () => {
    const { client, resetPasswordForEmail } = clientResolving(() => Promise.resolve({ data: {}, error: null }));

    await requestPasswordReset(client, "ada@example.test");

    expect(resetPasswordForEmail).toHaveBeenCalledWith("ada@example.test");
  });

  it("reports an accepted request", async () => {
    expect(await requestPasswordReset(clientReturning(null), "ada@example.test")).toEqual({
      outcome: "accepted",
      code: null,
      status: null,
    });
  });

  it("reports a returned refusal", async () => {
    const error = new AuthApiError("…", 429, "over_email_send_rate_limit");

    expect((await requestPasswordReset(clientReturning(error), "ada@example.test")).outcome).toBe("throttled");
  });

  it("reports a returned 5xx", async () => {
    const error = new AuthRetryableFetchError("Error sending recovery email", 500);

    expect((await requestPasswordReset(clientReturning(error), "ada@example.test")).outcome).toBe("send-failed");
  });

  it("never throws, even when the client does", async () => {
    const { client } = clientResolving(() => Promise.reject(new TypeError("fetch failed")));

    await expect(requestPasswordReset(client, "ada@example.test")).resolves.toEqual({
      outcome: "unexpected",
      code: null,
      status: null,
    });
  });
});
