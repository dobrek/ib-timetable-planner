import { DomainError, FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import {
  ACCOUNT_GONE_MESSAGE,
  ACCOUNT_NOT_ALLOWED_MESSAGE,
  BAN_FAILURE,
  CHANGE_EMAIL_FAILURE,
  CREATE_ACCOUNT_FAILURE,
  CREATE_ACCOUNT_UNKNOWN,
  DELETE_ACCOUNT_FAILURE,
  EMAIL_EXISTS_MESSAGE,
  EMAIL_REFUSED_MESSAGE,
  INVITATION_NOT_PENDING_MESSAGE,
  INVITE_FAILURE,
  INVITE_UNKNOWN,
  LAST_ADMIN_MESSAGE,
  NOT_PENDING_MESSAGE,
  REISSUE_FAILURE,
  RESEND_FAILURE,
  RESEND_TOO_SOON_MESSAGE,
  REVOKE_FAILURE,
  SESSION_EXPIRED_MESSAGE,
  UNBAN_FAILURE,
} from "./constants";

export type AccountOperation =
  | "create"
  | "reissue"
  | "invite"
  | "resend"
  | "revoke"
  | "ban"
  | "unban"
  | "delete"
  | "change_email";

/** The 409 codes the function names, each worded here. Any other code is never shown. */
const CLOSED_CONFLICTS = ["last_admin", "email_exists", "not_allowed"] as const;
export type ClosedConflict = (typeof CLOSED_CONFLICTS)[number];

/**
 * What the `admin-users` function's refusal means to the admin. The status is the function's own
 * contract (401 token, 403 not an admin, 404 unknown account, 409 conflict, 422 bad input, 429 an
 * invitation sent too recently, 500 failed and rolled back); the message is fixed here, never the
 * function's text, so no response body can reach the page.
 *
 * `status` is `null` when no response came back at all: the function was unreachable, or its answer
 * was lost, so the operation may have happened (`outcomeUnknown`).
 */
export function toAccountError(
  operation: AccountOperation,
  status: number | null,
  conflict: ClosedConflict | null = null,
): DomainError {
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
      return new DomainError("CONFLICT", conflictMessage(messages, conflict));
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

/** Whether a 409 body's `error` is one of the codes worded in `CONFLICT_MESSAGES`. */
export const isClosedConflict = (code: string): code is ClosedConflict =>
  (CLOSED_CONFLICTS as readonly string[]).includes(code);

type OperationMessages = {
  /**
   * 409 without a closed code: the target is no longer pending (reissue, resend, revoke), or the
   * address has an account (create, invite). `null` for an operation whose every conflict is coded
   * (ban, unban, delete, change email), which falls back to `failure`.
   */
  conflict: string | null;
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
  ban: { conflict: null, failure: BAN_FAILURE, unknown: BAN_FAILURE },
  unban: { conflict: null, failure: UNBAN_FAILURE, unknown: UNBAN_FAILURE },
  delete: { conflict: null, failure: DELETE_ACCOUNT_FAILURE, unknown: DELETE_ACCOUNT_FAILURE },
  change_email: { conflict: null, failure: CHANGE_EMAIL_FAILURE, unknown: CHANGE_EMAIL_FAILURE },
};

const CONFLICT_MESSAGES: Readonly<Record<ClosedConflict, string>> = {
  last_admin: LAST_ADMIN_MESSAGE,
  email_exists: EMAIL_EXISTS_MESSAGE,
  not_allowed: ACCOUNT_NOT_ALLOWED_MESSAGE,
};

/**
 * A closed code names its own sentence. Without one, the operation's conflict wording is used, or
 * its failure wording when every conflict it can meet is coded, so nothing from the body is shown.
 */
const conflictMessage = (messages: OperationMessages, conflict: ClosedConflict | null): string =>
  conflict === null ? (messages.conflict ?? messages.failure) : CONFLICT_MESSAGES[conflict];
