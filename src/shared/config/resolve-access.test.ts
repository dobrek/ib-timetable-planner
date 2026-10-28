import { describe, expect, it } from "vitest";
import type { AppRole } from "./app-role";
import { resolveAccess } from "./resolve-access";

const role = (value: AppRole | null): PromiseSettledResult<AppRole | null> => ({ status: "fulfilled", value });
const failed: PromiseSettledResult<AppRole | null> = { status: "rejected", reason: new Error("PostgREST down") };

describe("resolveAccess", () => {
  it("is none without a user, whatever the lookup said", () => {
    expect(resolveAccess(false, role("admin"))).toEqual({ status: "none" });
    expect(resolveAccess(false, role(null))).toEqual({ status: "none" });
    expect(resolveAccess(false, failed)).toEqual({ status: "none" });
  });

  it("is unavailable, never none, for a user whose lookup failed", () => {
    expect(resolveAccess(true, failed)).toEqual({ status: "unavailable" });
  });

  it("is none for a user without a role", () => {
    expect(resolveAccess(true, role(null))).toEqual({ status: "none" });
  });

  it.each(["admin", "author", "viewer"] as const)("is granted for a user holding %s", (held) => {
    expect(resolveAccess(true, role(held))).toEqual({ status: "granted", role: held });
  });
});
