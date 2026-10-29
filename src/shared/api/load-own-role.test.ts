import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { loadOwnRole } from "./load-own-role";

/**
 * The role read's interpretation of what `own_app_role()` answers. A value this build does not know
 * must throw, so the middleware reads it as `unavailable` rather than granting a role `grants()` has
 * no capabilities for.
 */
const answering = (result: { data: unknown; error: unknown }): SupabaseClient =>
  ({ rpc: () => Promise.resolve(result) }) as unknown as SupabaseClient;

describe("loadOwnRole", () => {
  it("returns a known role", async () => {
    await expect(loadOwnRole(answering({ data: "viewer", error: null }))).resolves.toBe("viewer");
  });

  it("returns null for a user without a role", async () => {
    await expect(loadOwnRole(answering({ data: null, error: null }))).resolves.toBeNull();
  });

  it("throws on a role this build does not know", async () => {
    await expect(loadOwnRole(answering({ data: "superuser", error: null }))).rejects.toBeInstanceOf(DomainError);
  });

  it("throws on a PostgREST error", async () => {
    const error = { code: "PGRST301", message: "JWT expired", details: "", hint: "" };
    await expect(loadOwnRole(answering({ data: null, error }))).rejects.toBeInstanceOf(DomainError);
  });
});
