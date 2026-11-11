import { DomainError, FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
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

export type AccountOperation = "create" | "reissue" | "invite" | "resend" | "revoke";

/**
 * What the `admin-users` function's refusal means to the admin. The status is the function's own
 * contract (401 token, 403 not an admin, 404 unknown account, 409 conflict, 422 bad input, 429 an
 * invitation sent too recently, 500 failed and rolled back); the message is fixed here, never the
 * function's text, so no response body can reach the page.
 *
 * `status` is `null` when no response came back at all: the function was unreachable, or its answer
 * was lost, so the operation may have happened (`outcomeUnknown`).
 */
export function toAccountError(operation: AccountOperation, status: number | null): DomainError {
  const messages = MESSAGES[operation];
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
      return new DomainError("CONFLICT", messages.conflict);
    case 422:
      return new DomainError("UNPROCESSABLE_CONTENT", EMAIL_REFUSED_MESSAGE);
    case 429:
      return new DomainError("TOO_MANY_REQUESTS", RESEND_TOO_SOON_MESSAGE);
    default:
      return new DomainError("INTERNAL_SERVER_ERROR", messages.failure);
  }
}

/**
 * An operation whose answer never arrived, or arrived without the fields it must hold: it may have
 * happened. A create may have made an account whose password nobody saw, which a re-issue recovers;
 * an invite may have sent an email, which the list shows; the rest are simply tried again.
 */
export const outcomeUnknown = (operation: AccountOperation): DomainError =>
  new DomainError("INTERNAL_SERVER_ERROR", MESSAGES[operation].unknown);

type OperationMessages = {
  /** 409: the address has an account (create, invite), or the target is no longer pending. */
  conflict: string;
  /** 500: the function failed, and undid what it could. */
  failure: string;
  /** No answer: it may have happened. */
  unknown: string;
};

/** One row per operation, so an operation added to `AccountOperation` does not compile until it is worded. */
const MESSAGES: Readonly<Record<AccountOperation, OperationMessages>> = {
  create: { conflict: EMAIL_EXISTS_MESSAGE, failure: CREATE_ACCOUNT_FAILURE, unknown: CREATE_ACCOUNT_UNKNOWN },
  reissue: { conflict: NOT_PENDING_MESSAGE, failure: REISSUE_FAILURE, unknown: REISSUE_FAILURE },
  invite: { conflict: EMAIL_EXISTS_MESSAGE, failure: INVITE_FAILURE, unknown: INVITE_UNKNOWN },
  resend: { conflict: INVITATION_NOT_PENDING_MESSAGE, failure: RESEND_FAILURE, unknown: RESEND_FAILURE },
  revoke: { conflict: INVITATION_NOT_PENDING_MESSAGE, failure: REVOKE_FAILURE, unknown: REVOKE_FAILURE },
};
