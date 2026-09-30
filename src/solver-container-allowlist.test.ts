import { describe, expect, it } from "vitest";
import { checkOpsAccess } from "./solver-container-allowlist";

describe("checkOpsAccess", () => {
  it("is closed to everyone when the secret is unset or empty — deny by default", () => {
    expect(checkOpsAccess("ops@example.test", undefined)).toBe("closed");
    expect(checkOpsAccess("ops@example.test", "")).toBe("closed");
    expect(checkOpsAccess("ops@example.test", " , ")).toBe("closed");
  });

  it("allows a listed address", () => {
    expect(checkOpsAccess("ops@example.test", "author@example.test,ops@example.test")).toBe("allowed");
  });

  it("denies an address that is not listed", () => {
    expect(checkOpsAccess("someone@example.test", "ops@example.test")).toBe("denied");
  });

  it("compares trimmed and case-insensitively", () => {
    expect(checkOpsAccess("  Ops@Example.TEST ", " ops@example.test ")).toBe("allowed");
  });

  it("ignores blank entries between commas", () => {
    expect(checkOpsAccess("b@x.test", " A@x.test,, b@X.test ,")).toBe("allowed");
  });

  it("denies a missing email against a non-empty list", () => {
    expect(checkOpsAccess(null, "ops@example.test")).toBe("denied");
    expect(checkOpsAccess(undefined, "ops@example.test")).toBe("denied");
    expect(checkOpsAccess("", "ops@example.test")).toBe("denied");
  });
});
