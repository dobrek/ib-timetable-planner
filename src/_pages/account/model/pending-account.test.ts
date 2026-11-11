import { describe, expect, it } from "vitest";
import { passwordSavedPath, pendingKindOf } from "./pending-account";

describe("pendingKindOf", () => {
  it("reads an account with an invitation on record as an invitee", () => {
    expect(pendingKindOf("2026-11-11T08:00:00Z")).toBe("invitation");
  });

  it("reads an account never invited as one on a temporary password", () => {
    expect(pendingKindOf(null)).toBe("temporary_password");
  });
});

describe("passwordSavedPath", () => {
  it("lands a first password in the app", () => {
    expect(passwordSavedPath(true)).toBe("/dashboard");
  });

  it("reloads the account page after any later change, which reports it", () => {
    expect(passwordSavedPath(false)).toBe("/account?saved=password");
  });
});
