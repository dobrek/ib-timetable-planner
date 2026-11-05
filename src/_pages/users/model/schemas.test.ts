import { describe, expect, it } from "vitest";
import { APP_ROLE_VALUES } from "@/shared/config";
import { changeUserRoleInput } from "./schemas";

const USER_ID = "6f1c2a3e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";

describe("changeUserRoleInput", () => {
  it.each([...APP_ROLE_VALUES, null])("accepts the role %s", (role) => {
    expect(changeUserRoleInput.parse({ userId: USER_ID, role })).toEqual({ userId: USER_ID, role });
  });

  it.each([
    ["a role outside the enum", { userId: USER_ID, role: "owner" }],
    ["a missing role, since No access is said explicitly", { userId: USER_ID }],
    ["a user id that is not a uuid", { userId: "not-a-uuid", role: "viewer" }],
  ])("refuses %s", (_label, input) => {
    expect(changeUserRoleInput.safeParse(input).success).toBe(false);
  });
});
