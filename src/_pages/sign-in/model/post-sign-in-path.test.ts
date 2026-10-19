import { describe, expect, it } from "vitest";
import { postSignInPath } from "./post-sign-in-path";

describe("postSignInPath", () => {
  it("lands on the dashboard with the weak-password notice when GoTrue flags the password", () => {
    expect(postSignInPath({ weakPassword: { reasons: ["length"], message: "Password is too short" } })).toBe(
      "/dashboard?notice=weak-password",
    );
  });

  it("lands on the plain dashboard otherwise", () => {
    expect(postSignInPath({})).toBe("/dashboard");
  });
});
