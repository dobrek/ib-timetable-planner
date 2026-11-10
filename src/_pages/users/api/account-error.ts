import { DomainError, FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import {
  ACCOUNT_GONE_MESSAGE,
  CREATE_ACCOUNT_FAILURE,
  EMAIL_EXISTS_MESSAGE,
  EMAIL_REFUSED_MESSAGE,
  NOT_PENDING_MESSAGE,
  REISSUE_FAILURE,
  SESSION_EXPIRED_MESSAGE,
} from "./constants";

export type AccountOperation = "create" | "reissue";

/**
 * What the `admin-users` function's refusal means to the admin. The status is the function's own
 * contract (401 token, 403 not an admin, 404 unknown account, 409 conflict, 422 bad input); the
 * message is fixed here, never the function's text, so no response body can reach the page.
 *
 * `status` is `null` when no response came back at all (the function was unreachable).
 */
export function toAccountError(operation: AccountOperation, status: number | null): DomainError {
  switch (status) {
    case 401:
      return new DomainError("UNAUTHORIZED", SESSION_EXPIRED_MESSAGE);
    case 403:
      return new DomainError("FORBIDDEN", FORBIDDEN_MESSAGE);
    case 404:
      return new DomainError("NOT_FOUND", ACCOUNT_GONE_MESSAGE);
    case 409:
      return operation === "create"
        ? new DomainError("CONFLICT", EMAIL_EXISTS_MESSAGE)
        : new DomainError("CONFLICT", NOT_PENDING_MESSAGE);
    case 422:
      return new DomainError("UNPROCESSABLE_CONTENT", EMAIL_REFUSED_MESSAGE);
    default:
      return new DomainError("INTERNAL_SERVER_ERROR", failureOf(operation));
  }
}

const failureOf = (operation: AccountOperation): string =>
  operation === "create" ? CREATE_ACCOUNT_FAILURE : REISSUE_FAILURE;
