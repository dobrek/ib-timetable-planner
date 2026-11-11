import { describe, expect, it } from "vitest";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { toAccountError } from "./account-error";
import {
  ACCOUNT_GONE_MESSAGE,
  CREATE_ACCOUNT_FAILURE,
  CREATE_ACCOUNT_UNKNOWN,
  EMAIL_EXISTS_MESSAGE,
  EMAIL_REFUSED_MESSAGE,
  INVITATION_NOT_PENDING_MESSAGE,
  INVITE_FAILURE,
  INVITE_UNKNOWN,
  NOT_PENDING_MESSAGE,
  REISSUE_FAILURE,
  RESEND_FAILURE,
  RESEND_TOO_SOON_MESSAGE,
  REVOKE_FAILURE,
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
    ["invite", 401, "UNAUTHORIZED", SESSION_EXPIRED_MESSAGE],
    ["invite", 403, "FORBIDDEN", FORBIDDEN_MESSAGE],
    ["invite", 409, "CONFLICT", EMAIL_EXISTS_MESSAGE],
    ["invite", 422, "UNPROCESSABLE_CONTENT", EMAIL_REFUSED_MESSAGE],
    ["invite", 429, "TOO_MANY_REQUESTS", RESEND_TOO_SOON_MESSAGE],
    ["invite", 500, "INTERNAL_SERVER_ERROR", INVITE_FAILURE],
    ["resend", 404, "NOT_FOUND", ACCOUNT_GONE_MESSAGE],
    ["resend", 409, "CONFLICT", INVITATION_NOT_PENDING_MESSAGE],
    ["resend", 429, "TOO_MANY_REQUESTS", RESEND_TOO_SOON_MESSAGE],
    ["resend", 500, "INTERNAL_SERVER_ERROR", RESEND_FAILURE],
    ["revoke", 404, "NOT_FOUND", ACCOUNT_GONE_MESSAGE],
    ["revoke", 409, "CONFLICT", INVITATION_NOT_PENDING_MESSAGE],
    ["revoke", 500, "INTERNAL_SERVER_ERROR", REVOKE_FAILURE],
  ] as const)("%s, status %s → %s", (operation, status, code, message) => {
    const error = toAccountError(operation, status);

    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("reads a function that never answered as an outcome nobody knows: the account may exist", () => {
    expect(toAccountError("create", null).message).toBe(CREATE_ACCOUNT_UNKNOWN);
    expect(toAccountError("reissue", null).message).toBe(REISSUE_FAILURE);
    expect(toAccountError("invite", null).message).toBe(INVITE_UNKNOWN);
    expect(toAccountError("resend", null).message).toBe(RESEND_FAILURE);
    expect(toAccountError("revoke", null).message).toBe(REVOKE_FAILURE);
  });

  it("points an unknown invite at the list, where a sent invitation shows", () => {
    expect(INVITE_UNKNOWN).toMatch(/may have been sent/);
    expect(INVITE_UNKNOWN).toMatch(/Check the list/);
  });

  it("says that nothing was issued when a create fails, so the admin checks the list, not the password", () => {
    expect(CREATE_ACCOUNT_FAILURE).toMatch(/no password was issued/);
  });

  it("points an unknown create at the list and a re-issue, the way to a password for an account that exists", () => {
    expect(CREATE_ACCOUNT_UNKNOWN).toMatch(/may exist/);
    expect(CREATE_ACCOUNT_UNKNOWN).toMatch(/re-issue/);
  });
});
