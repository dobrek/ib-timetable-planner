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

/** The 409 codes ban, unban, delete and change-email answer. Anything else is not shown. */
const CLOSED_CONFLICTS = ["last_admin", "email_exists", "not_allowed"] as const;
type ClosedConflict = (typeof CLOSED_CONFLICTS)[number];

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
  conflict: string | null = null,
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
      return new DomainError("CONFLICT", conflictMessage(operation, messages, conflict));
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
  ban: { conflict: ACCOUNT_NOT_ALLOWED_MESSAGE, failure: BAN_FAILURE, unknown: BAN_FAILURE },
  unban: { conflict: ACCOUNT_NOT_ALLOWED_MESSAGE, failure: UNBAN_FAILURE, unknown: UNBAN_FAILURE },
  delete: { conflict: ACCOUNT_NOT_ALLOWED_MESSAGE, failure: DELETE_ACCOUNT_FAILURE, unknown: DELETE_ACCOUNT_FAILURE },
  change_email: { conflict: EMAIL_EXISTS_MESSAGE, failure: CHANGE_EMAIL_FAILURE, unknown: CHANGE_EMAIL_FAILURE },
};

const CODED: ReadonlySet<AccountOperation> = new Set(["ban", "unban", "delete", "change_email"]);

/**
 * Ban, unban, delete and change-email name which 409 they mean. A code outside that closed set is
 * not the function's sentence: the failure wording is used, so nothing from the body is shown.
 */
const conflictMessage = (operation: AccountOperation, messages: OperationMessages, conflict: string | null): string => {
  if (!CODED.has(operation)) return messages.conflict;
  if (conflict === "last_admin") return LAST_ADMIN_MESSAGE;
  if (conflict === "email_exists") return EMAIL_EXISTS_MESSAGE;
  if (conflict === "not_allowed") return ACCOUNT_NOT_ALLOWED_MESSAGE;
  return messages.failure;
};

export const isClosedConflict = (code: string): code is ClosedConflict =>
  (CLOSED_CONFLICTS as readonly string[]).includes(code);
