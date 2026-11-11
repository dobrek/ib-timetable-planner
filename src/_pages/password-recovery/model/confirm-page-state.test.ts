import { describe, expect, it } from "vitest";
import { confirmFailurePath, confirmPageState, confirmPageTitle, LINK_COPY } from "./confirm-page-state";

const HASH = "a".repeat(56);

describe("confirmFailurePath", () => {
  it("sends a refused reset link back to the reset form, as before", () => {
    expect(confirmFailurePath("recovery", "expired")).toBe("/auth/forgot?error=link-expired");
    expect(confirmFailurePath("recovery", "retry")).toBe("/auth/forgot?error=link-retry");
  });

  it("keeps a refused invitation on the confirm page, which tells the invitee to ask their admin", () => {
    expect(confirmFailurePath("invite", "expired")).toBe("/auth/confirm?error=invite-expired");
    expect(confirmFailurePath("invite", "retry")).toBe("/auth/confirm?error=invite-retry");
  });
});

describe("confirmPageState", () => {
  it.each(["recovery", "invite"] as const)("reads a %s link, waiting for Continue", (type) => {
    expect(confirmPageState(new URLSearchParams({ token_hash: HASH, type }))).toEqual({
      kind: "link",
      link: { tokenHash: HASH, type },
    });
  });

  it("reads back each failure the endpoint sends an invitation to", () => {
    expect(confirmPageState(new URLSearchParams({ error: "invite-expired" }))).toEqual({
      kind: "invite-failed",
      reason: "expired",
    });
    expect(confirmPageState(new URLSearchParams({ error: "invite-retry" }))).toEqual({
      kind: "invite-failed",
      reason: "retry",
    });
  });

  it("lets a link win over an error: it is a fresh attempt", () => {
    const params = new URLSearchParams({ token_hash: HASH, type: "invite", error: "invite-expired" });

    expect(confirmPageState(params).kind).toBe("link");
  });

  it.each([
    ["nothing", {}],
    ["a malformed link", { token_hash: "%2F", type: "invite" }],
    ["a type not on the allowlist", { token_hash: HASH, type: "signup" }],
    ["an unknown error", { error: "link-expired" }],
    ["an error reaching for the prototype", { error: "constructor" }],
  ])("reads %s as incomplete", (_label, query) => {
    expect(confirmPageState(new URLSearchParams(query))).toEqual({ kind: "incomplete" });
  });
});

describe("confirmPageTitle", () => {
  it("names a link by its type, and a failed invitation as an invitation", () => {
    expect(confirmPageTitle({ kind: "link", link: { tokenHash: HASH, type: "recovery" } })).toBe("Reset your password");
    expect(confirmPageTitle({ kind: "link", link: { tokenHash: HASH, type: "invite" } })).toBe(
      "Accept your invitation",
    );
    expect(confirmPageTitle({ kind: "invite-failed", reason: "expired" })).toBe("Accept your invitation");
  });

  it("says nothing about resets when there is no link: it could have been any email", () => {
    expect(confirmPageTitle({ kind: "incomplete" })).toBe("Incomplete link");
  });
});

describe("LINK_COPY", () => {
  it("keeps the reset wording S-402 shipped, and gives an invitation its own", () => {
    expect(LINK_COPY.recovery.lead).toBe("Press Continue to sign in and choose a new password. The link works once.");
    expect(LINK_COPY.invite.lead).toBe("Press Continue to sign in and choose your password. The link works once.");
  });
});
