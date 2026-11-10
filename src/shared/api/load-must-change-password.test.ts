import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { loadMustChangePassword } from "./load-must-change-password";

/** The flag read's interpretation of the caller's own `user_directory` row. */
const answering = (result: { data: unknown; error: unknown }): SupabaseClient =>
  ({
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(result) }) }),
  }) as unknown as SupabaseClient;

describe("loadMustChangePassword", () => {
  it("returns true when the flag is set", async () => {
    await expect(
      loadMustChangePassword(answering({ data: { must_change_password: true }, error: null })),
    ).resolves.toBe(true);
  });

  it("returns false when the flag is clear", async () => {
    await expect(
      loadMustChangePassword(answering({ data: { must_change_password: false }, error: null })),
    ).resolves.toBe(false);
  });

  it("returns false when there is no directory row to read", async () => {
    await expect(loadMustChangePassword(answering({ data: null, error: null }))).resolves.toBe(false);
  });

  it("throws on a PostgREST error, which the middleware reads as unavailable, never as no flag", async () => {
    const error = { code: "PGRST301", message: "JWT expired", details: "", hint: "" };
    await expect(loadMustChangePassword(answering({ data: null, error }))).rejects.toBeInstanceOf(DomainError);
  });
});
