import { describe, expect, it } from "vitest";
import { type ForgotReason, forgotPageState, forgotPath } from "./forgot-page-state";

const stateOf = (path: string, configured = true) =>
  forgotPageState(new URL(path, "http://localhost").searchParams, { configured });

describe("forgotPath / forgotPageState", () => {
  it.each<[ForgotReason, ReturnType<typeof stateOf>]>([
    ["sent", { kind: "sent" }],
    ["unavailable", { kind: "unavailable" }],
    ["verification", { kind: "form", alert: "verification" }],
    ["link-expired", { kind: "form", alert: "link-expired" }],
    ["link-invalid", { kind: "form", alert: "link-invalid" }],
    ["link-retry", { kind: "form", alert: "link-retry" }],
  ])("round-trips %s", (reason, state) => {
    const path = forgotPath(reason);

    expect(path.startsWith("/auth/forgot?")).toBe(true);
    expect(stateOf(path)).toEqual(state);
  });

  it("renders the plain form with no query", () => {
    expect(stateOf("/auth/forgot")).toEqual({ kind: "form", alert: null });
  });

  it.each(["/auth/forgot?error=nope", "/auth/forgot?status=nope", "/auth/forgot?error=", "/auth/forgot?notice=sent"])(
    "reads an unknown value as the plain form: %s",
    (path) => {
      expect(stateOf(path)).toEqual({ kind: "form", alert: null });
    },
  );

  it.each(["/auth/forgot", "/auth/forgot?status=sent", "/auth/forgot?error=link-expired"])(
    "is always unavailable when reset is not configured: %s",
    (path) => {
      expect(stateOf(path, false)).toEqual({ kind: "unavailable" });
    },
  );
});
