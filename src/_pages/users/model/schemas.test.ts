import { describe, expect, it } from "vitest";
import { APP_ROLE_VALUES } from "@/shared/config";
import { changeUserRoleInput, createAccountFormSchema, createAccountInput, reissuePasswordInput } from "./schemas";

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

describe("createAccountInput", () => {
  it.each([...APP_ROLE_VALUES, null])("accepts the role %s", (role) => {
    expect(createAccountInput.parse({ email: "dee@example.test", role })).toEqual({ email: "dee@example.test", role });
  });

  it("trims and lower-cases the address, as the function does", () => {
    expect(createAccountInput.parse({ email: "  Dee@Example.TEST ", role: "viewer" }).email).toBe("dee@example.test");
  });

  it.each([
    ["an address that is not one", { email: "dee", role: "viewer" }],
    ["a missing role, since No access is said explicitly", { email: "dee@example.test" }],
    ["a role outside the enum", { email: "dee@example.test", role: "owner" }],
  ])("refuses %s", (_label, input) => {
    expect(createAccountInput.safeParse(input).success).toBe(false);
  });

  it("has no password field: the function generates it, so a typed one is dropped", () => {
    const parsed = createAccountInput.parse({ email: "dee@example.test", role: "viewer", password: "hunter2hunter2" });
    expect(parsed).toEqual({ email: "dee@example.test", role: "viewer" });
  });
});

describe("createAccountFormSchema", () => {
  const form = { email: "dee@example.test", confirmEmail: "dee@example.test", role: "viewer" };

  it("accepts the address typed twice, whatever the case or the padding", () => {
    expect(createAccountFormSchema.safeParse(form).success).toBe(true);
    expect(createAccountFormSchema.safeParse({ ...form, confirmEmail: " DEE@example.test " }).success).toBe(true);
  });

  it("refuses two different addresses, on the confirmation field", () => {
    const result = createAccountFormSchema.safeParse({ ...form, confirmEmail: "dea@example.test" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmEmail"]);
  });
});

describe("reissuePasswordInput", () => {
  it("takes one user id", () => {
    expect(reissuePasswordInput.parse({ userId: USER_ID })).toEqual({ userId: USER_ID });
    expect(reissuePasswordInput.safeParse({ userId: "nope" }).success).toBe(false);
  });
});
