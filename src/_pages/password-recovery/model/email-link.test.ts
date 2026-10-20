import { describe, expect, it } from "vitest";
import { landingPathFor, parseEmailLink } from "./email-link";

const HASH = "a".repeat(56);

describe("parseEmailLink", () => {
  it("reads a recovery link from a query string", () => {
    const params = new URLSearchParams({ token_hash: HASH, type: "recovery" });

    expect(parseEmailLink(params)).toEqual({ tokenHash: HASH, type: "recovery" });
  });

  it("reads the same link from a form body", () => {
    const form = new FormData();
    form.set("token_hash", HASH);
    form.set("type", "recovery");

    expect(parseEmailLink(form)).toEqual({ tokenHash: HASH, type: "recovery" });
  });

  it("keeps a PKCE-prefixed hash, which GoTrue verifies as is", () => {
    const params = new URLSearchParams({ token_hash: `pkce_${HASH}`, type: "recovery" });

    expect(parseEmailLink(params)?.tokenHash).toBe(`pkce_${HASH}`);
  });

  it.each(["invite", "signup", "magiclink", "email_change", "email", "Recovery", ""])(
    "refuses the type %j, which is not on the allowlist",
    (type) => {
      expect(parseEmailLink(new URLSearchParams({ token_hash: HASH, type }))).toBeNull();
    },
  );

  it("refuses a missing type", () => {
    expect(parseEmailLink(new URLSearchParams({ token_hash: HASH }))).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["over-long", "a".repeat(129)],
    ["a URL fragment", `${HASH}#x`],
    ["a space", `${HASH} x`],
    ["a dot", `${HASH}.x`],
    ["percent-encoded text", "%2F"],
  ])("refuses a %s token_hash", (_label, tokenHash) => {
    const params = new URLSearchParams({ type: "recovery" });
    if (tokenHash !== undefined) params.set("token_hash", tokenHash);

    expect(parseEmailLink(params)).toBeNull();
  });

  it("refuses a file where the hash should be", () => {
    const form = new FormData();
    form.set("token_hash", new Blob([HASH]));
    form.set("type", "recovery");

    expect(parseEmailLink(form)).toBeNull();
  });
});

describe("landingPathFor", () => {
  it("lands a recovery on the account page's password form, with its banner", () => {
    expect(landingPathFor("recovery")).toBe("/account?notice=recovery");
  });
});
