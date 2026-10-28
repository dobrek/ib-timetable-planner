import { describe, expect, it } from "vitest";
import type { AccessState } from "./access-state";
import { decideRoleGate, ROLE_NOTICE_PATH, ROLE_UNAVAILABLE_PATH } from "./role-gate";

const VIEWER: AccessState = { status: "granted", role: "viewer" };
const AUTHOR: AccessState = { status: "granted", role: "author" };
const NONE: AccessState = { status: "none" };
const UNAVAILABLE: AccessState = { status: "unavailable" };

describe("decideRoleGate", () => {
  it.each(["/account", "/api/solver/container", ROLE_UNAVAILABLE_PATH])(
    "allows the role-exempt %s in every state",
    (path) => {
      for (const access of [AUTHOR, VIEWER, NONE, UNAVAILABLE]) {
        expect(decideRoleGate(path, access)).toBe("allow");
      }
    },
  );

  it("renders the notice page for a granted or role-less user, and the 503 for a failed lookup", () => {
    expect(ROLE_NOTICE_PATH).toBe("/dashboard");
    expect(decideRoleGate(ROLE_NOTICE_PATH, AUTHOR)).toBe("allow");
    expect(decideRoleGate(ROLE_NOTICE_PATH, VIEWER)).toBe("allow");
    expect(decideRoleGate(ROLE_NOTICE_PATH, NONE)).toBe("allow");
    expect(decideRoleGate(ROLE_NOTICE_PATH, UNAVAILABLE)).toBe("unavailable");
  });

  it.each(["/plans", "/plans/5c7cce84-0000-4000-8000-000000000001", "/plans/compare", "/"])(
    "gates %s by status",
    (path) => {
      expect(decideRoleGate(path, AUTHOR)).toBe("allow");
      expect(decideRoleGate(path, VIEWER)).toBe("allow");
      expect(decideRoleGate(path, NONE)).toBe("notice");
      expect(decideRoleGate(path, UNAVAILABLE)).toBe("unavailable");
    },
  );

  it("matches exempt paths exactly, so a look-alike is gated", () => {
    expect(decideRoleGate("/account-export", NONE)).toBe("notice");
    expect(decideRoleGate("/api/solver/container/x", NONE)).toBe("notice");
  });
});
