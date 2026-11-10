import { DomainError, FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
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

export type AccountOperation = "create" | "reissue";

/**
 * What the `admin-users` function's refusal means to the admin. The status is the function's own
 * contract (401 token, 403 not an admin, 404 unknown account, 409 conflict, 422 bad input, 500 failed
 * and rolled back); the message is fixed here, never the function's text, so no response body can
 * reach the page.
 *
 * `status` is `null` when no response came back at all: the function was unreachable, or its answer
 * was lost, so the operation may have happened (`outcomeUnknown`).
 */
export function toAccountError(operation: AccountOperation, status: number | null): DomainError {
  switch (status) {
    case null:
      return outcomeUnknown(operation);
    case 401:
      return new DomainError("UNAUTHORIZED", SESSION_EXPIRED_MESSAGE);
    case 403:
      return new DomainError("FORBIDDEN", FORBIDDEN_MESSAGE);
    case 404:
      return new DomainError("NOT_FOUND", ACCOUNT_GONE_MESSAGE);
    case 409:
      return new DomainError("CONFLICT", operation === "create" ? EMAIL_EXISTS_MESSAGE : NOT_PENDING_MESSAGE);
    case 422:
      return new DomainError("UNPROCESSABLE_CONTENT", EMAIL_REFUSED_MESSAGE);
    default:
      return new DomainError(
        "INTERNAL_SERVER_ERROR",
        operation === "create" ? CREATE_ACCOUNT_FAILURE : REISSUE_FAILURE,
      );
  }
}

/**
 * An operation whose answer never arrived, or arrived without a password: it may have happened. A
 * create may have made an account whose password nobody saw, which a re-issue recovers; a re-issue
 * is simply tried again.
 */
export const outcomeUnknown = (operation: AccountOperation): DomainError =>
  new DomainError("INTERNAL_SERVER_ERROR", operation === "create" ? CREATE_ACCOUNT_UNKNOWN : REISSUE_FAILURE);
