import { describe, expect, it } from "vitest";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { toAccountError } from "./account-error";
import {
  ACCOUNT_GONE_MESSAGE,
  CREATE_ACCOUNT_FAILURE,
  CREATE_ACCOUNT_UNKNOWN,
  EMAIL_EXISTS_MESSAGE,
  EMAIL_REFUSED_MESSAGE,
  NOT_PENDING_MESSAGE,
  REISSUE_FAILURE,
  SESSION_EXPIRED_MESSAGE,
} from "./constants";

/** The function's status contract, as the admin reads it: a code the action returns and a fixed message. */
describe("toAccountError", () => {
  it.each([
    ["create", 401, "UNAUTHORIZED", SESSION_EXPIRED_MESSAGE],
    ["create", 403, "FORBIDDEN", FORBIDDEN_MESSAGE],
    ["create", 409, "CONFLICT", EMAIL_EXISTS_MESSAGE],
    ["create", 422, "UNPROCESSABLE_CONTENT", EMAIL_REFUSED_MESSAGE],
    ["create", 500, "INTERNAL_SERVER_ERROR", CREATE_ACCOUNT_FAILURE],
    ["reissue", 401, "UNAUTHORIZED", SESSION_EXPIRED_MESSAGE],
    ["reissue", 403, "FORBIDDEN", FORBIDDEN_MESSAGE],
    ["reissue", 404, "NOT_FOUND", ACCOUNT_GONE_MESSAGE],
    ["reissue", 409, "CONFLICT", NOT_PENDING_MESSAGE],
    ["reissue", 500, "INTERNAL_SERVER_ERROR", REISSUE_FAILURE],
  ] as const)("%s, status %s → %s", (operation, status, code, message) => {
    const error = toAccountError(operation, status);

    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("reads a function that never answered as an outcome nobody knows: the account may exist", () => {
    expect(toAccountError("create", null).message).toBe(CREATE_ACCOUNT_UNKNOWN);
    expect(toAccountError("reissue", null).message).toBe(REISSUE_FAILURE);
  });

  it("says that nothing was issued when a create fails, so the admin checks the list, not the password", () => {
    expect(CREATE_ACCOUNT_FAILURE).toMatch(/no password was issued/);
  });

  it("points an unknown create at the list and a re-issue, the way to a password for an account that exists", () => {
    expect(CREATE_ACCOUNT_UNKNOWN).toMatch(/may exist/);
    expect(CREATE_ACCOUNT_UNKNOWN).toMatch(/re-issue/);
  });
});
