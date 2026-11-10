import { describe, expect, it } from "vitest";
import type { AppRole } from "./app-role";
import { resolveAccess, type OwnAccessRead } from "./resolve-access";

const read = (role: AppRole | null, mustChangePassword = false): PromiseSettledResult<OwnAccessRead> => ({
  status: "fulfilled",
  value: { role, mustChangePassword },
});
// A rejected lookup is the role read failing or, for a caller with no role, the flag read failing.
const failed: PromiseSettledResult<OwnAccessRead> = { status: "rejected", reason: new Error("PostgREST down") };

describe("resolveAccess", () => {
  it("is none without a user, whatever the lookup said", () => {
    expect(resolveAccess(false, read("admin"))).toEqual({ status: "none" });
    expect(resolveAccess(false, read(null))).toEqual({ status: "none" });
    expect(resolveAccess(false, read(null, true))).toEqual({ status: "none" });
    expect(resolveAccess(false, failed)).toEqual({ status: "none" });
  });

  it("is unavailable, never none and never password_change_required, for a user whose lookup failed", () => {
    expect(resolveAccess(true, failed)).toEqual({ status: "unavailable" });
  });

  it("is none for a user without a role and without the flag", () => {
    expect(resolveAccess(true, read(null))).toEqual({ status: "none" });
  });

  it("is password_change_required for a user without a role whose flag is set", () => {
    expect(resolveAccess(true, read(null, true))).toEqual({ status: "password_change_required" });
  });

  it.each(["admin", "author", "viewer"] as const)("is granted for a user holding %s", (held) => {
    expect(resolveAccess(true, read(held))).toEqual({ status: "granted", role: held });
  });

  it("trusts a held role over the flag, which RLS makes impossible to set alongside one", () => {
    expect(resolveAccess(true, read("viewer", true))).toEqual({ status: "granted", role: "viewer" });
  });
});
