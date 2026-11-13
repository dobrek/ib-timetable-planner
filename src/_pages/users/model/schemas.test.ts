import { describe, expect, it } from "vitest";
import { APP_ROLE_VALUES } from "@/shared/config";
import {
  changeUserEmailFormSchema,
  changeUserRoleInput,
  createAccountFormSchema,
  createAccountInput,
  inviteUserInput,
  userTargetInput,
} from "./schemas";

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

describe("inviteUserInput", () => {
  it.each(APP_ROLE_VALUES)("accepts the role %s", (role) => {
    expect(inviteUserInput.parse({ email: "eve@example.test", role })).toEqual({ email: "eve@example.test", role });
  });

  it("trims and lower-cases the address, as the function does", () => {
    expect(inviteUserInput.parse({ email: " Eve@Example.TEST ", role: "viewer" }).email).toBe("eve@example.test");
  });

  it.each([
    ["No access, since an invitation must grant a role", { email: "eve@example.test", role: null }],
    ["a missing role", { email: "eve@example.test" }],
    ["a role outside the enum", { email: "eve@example.test", role: "owner" }],
    ["an address that is not one", { email: "eve", role: "viewer" }],
  ])("refuses %s", (_label, input) => {
    expect(inviteUserInput.safeParse(input).success).toBe(false);
  });
});

describe("userTargetInput", () => {
  it("takes one user id", () => {
    expect(userTargetInput.parse({ userId: USER_ID })).toEqual({ userId: USER_ID });
    expect(userTargetInput.safeParse({ userId: "nope" }).success).toBe(false);
  });
});

describe("changeUserEmailFormSchema", () => {
  it("accepts the same address typed twice, whatever its case and spacing, and refuses two different ones", () => {
    expect(changeUserEmailFormSchema.parse({ email: " Ida@School.test ", confirmEmail: "ida@school.test" })).toEqual({
      email: "ida@school.test",
      confirmEmail: "ida@school.test",
    });
    const mismatch = changeUserEmailFormSchema.safeParse({ email: "ida@school.test", confirmEmail: "ide@school.test" });
    expect(mismatch.error?.issues).toEqual([
      expect.objectContaining({ path: ["confirmEmail"], message: "The two addresses don't match." }),
    ]);
  });
});
