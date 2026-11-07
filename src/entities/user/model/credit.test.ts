import { describe, expect, it } from "vitest";
import { creditFor, creditText, type CreditedUser } from "./credit";

const ada: CreditedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  label: { primary: "Ada Lovelace", secondary: "ada@example.test" },
  isServiceAccount: false,
};
const campaign: CreditedUser = {
  id: "22222222-2222-4222-8222-222222222222",
  label: { primary: "campaign@example.test", secondary: null },
  isServiceAccount: true,
};
const USERS = new Map([ada, campaign].map((user) => [user.id, user]));

describe("creditFor", () => {
  it("credits a user the page loaded", () => {
    expect(creditFor(ada.id, USERS)).toEqual({ kind: "user", user: ada });
  });

  it("credits a service account as itself, so the badge can say what it is", () => {
    expect(creditFor(campaign.id, USERS)).toEqual({ kind: "user", user: campaign });
  });

  it("reads a null id as unknown: a row from before S-407, or whose person was deleted", () => {
    expect(creditFor(null, USERS)).toEqual({ kind: "unknown" });
  });

  it("reads an id the directory does not list as unknown", () => {
    expect(creditFor("33333333-3333-4333-8333-333333333333", USERS)).toEqual({ kind: "unknown" });
  });
});

describe("creditText", () => {
  it("brackets the email after the name", () => {
    expect(creditText({ kind: "user", user: ada })).toBe("Ada Lovelace (ada@example.test)");
  });

  it("is the email alone when there is no name", () => {
    expect(creditText({ kind: "user", user: campaign })).toBe("campaign@example.test");
  });

  it("reads Unknown when the credit names nobody", () => {
    expect(creditText({ kind: "unknown" })).toBe("Unknown");
  });
});
