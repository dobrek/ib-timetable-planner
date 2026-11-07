import { describe, expect, it } from "vitest";
import { buildCreditedUsers } from "./credited-users";

const ADA = "11111111-1111-4111-8111-111111111111";
const BEA = "22222222-2222-4222-8222-222222222222";

describe("buildCreditedUsers", () => {
  it("names each directory entry from its profile, or by email when it has none", () => {
    const users = buildCreditedUsers({
      directory: [
        { user_id: ADA, email: "ada@example.test", is_service_account: false },
        { user_id: BEA, email: "bea@example.test", is_service_account: true },
      ],
      profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }],
    });

    expect(Object.fromEntries(users)).toEqual({
      [ADA]: { id: ADA, label: { primary: "Ada Lovelace", secondary: "ada@example.test" }, isServiceAccount: false },
      [BEA]: { id: BEA, label: { primary: "bea@example.test", secondary: null }, isServiceAccount: true },
    });
  });

  it("ignores a profile with no directory entry: the directory decides who can be credited", () => {
    const users = buildCreditedUsers({ directory: [], profiles: [{ user_id: ADA, display_name: "Ada Lovelace" }] });

    expect(users.size).toBe(0);
  });
});
