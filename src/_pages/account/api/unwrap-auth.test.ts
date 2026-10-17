import { AuthApiError, AuthSessionMissingError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/lib/errors";
import {
  PASSWORD_REUSED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SESSION_ENDED_MESSAGE,
} from "./constants";
import { unwrapAuth } from "./unwrap-auth";

/** Each row of the mapper, with the error supabase-js itself constructs for that response. No network. */
describe("unwrapAuth", () => {
  it("returns the data when there is no error", () => {
    expect(unwrapAuth({ data: { user: "u1" }, error: null })).toEqual({ user: "u1" });
  });

  it.each([
    [
      "a password under the floor",
      new AuthWeakPasswordError("Password should be at least 15 characters.", 422, ["length"]),
      "UNPROCESSABLE_CONTENT",
      PASSWORD_TOO_SHORT_MESSAGE,
    ],
    [
      "a weak password for another reason, in GoTrue's words",
      new AuthWeakPasswordError("Password is known to be weak and easy to guess.", 422, ["pwned"]),
      "UNPROCESSABLE_CONTENT",
      "Password is known to be weak and easy to guess.",
    ],
    [
      "the current password again",
      new AuthApiError("New password should be different from the old password.", 422, "same_password"),
      "UNPROCESSABLE_CONTENT",
      PASSWORD_REUSED_MESSAGE,
    ],
    [
      "a rate limit",
      new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
      "TOO_MANY_REQUESTS",
      RATE_LIMITED_MESSAGE,
    ],
    ["a missing or revoked session", new AuthSessionMissingError(), "UNAUTHORIZED", SESSION_ENDED_MESSAGE],
    [
      "a hosted toggle flipped on, in GoTrue's words",
      new AuthApiError("Password update requires reauthentication.", 400, "reauthentication_needed"),
      "INTERNAL_SERVER_ERROR",
      "Password update requires reauthentication.",
    ],
  ])("maps %s", (_why, error, code, message) => {
    const thrown = grab(() => unwrapAuth({ data: { user: null }, error }));
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code, message });
  });
});

const grab = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the function to throw");
};
