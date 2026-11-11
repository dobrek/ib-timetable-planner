/** The last-admin guard's refusal (SQLSTATE PT409), in the trigger's own words. */
export const LAST_ADMIN_MESSAGE = "The school must keep at least one admin.";
export const NO_ROLE_TO_REMOVE_MESSAGE = "That user already has no access.";
export const CHANGE_ROLE_FAILURE = "Failed to change the role";
export const REMOVE_ROLE_FAILURE = "Failed to remove the role";

// Account provisioning (S-409). Fixed wording only: nothing from the function's response, and never
// a password, reaches a message or a log.
export const CREATE_ACCOUNT_FAILURE =
  "Couldn't create the account, and no password was issued. Check the list before trying again.";
export const CREATE_ACCOUNT_UNKNOWN =
  "The request didn't finish, so the account may exist. Check the list: if it's there, re-issue its password.";
export const REISSUE_FAILURE = "Couldn't issue a new password. Try again.";
export const EMAIL_EXISTS_MESSAGE = "An account with this email already exists.";
export const EMAIL_REFUSED_MESSAGE = "That email address was not accepted.";
export const NOT_PENDING_MESSAGE = "That person has already chosen their own password.";
export const ACCOUNT_GONE_MESSAGE = "That account no longer exists.";
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again.";
/** The request never completed (a network drop, a Worker restart): nothing is known to have been created. */
export const ACCOUNT_UNREACHABLE_MESSAGE = "Couldn't reach the server. Check the list before trying again.";

// Invitations by email (S-410). Fixed wording only, as above: nothing from the function's response,
// and never a link or token, reaches a message or a log.
// Neutral on purpose: a failed invite to a new address leaves nothing, but one to a pending address
// may already have applied the new role before the send failed.
export const INVITE_FAILURE = "Couldn't send the invitation. Check the list before trying again.";
export const INVITE_UNKNOWN = "The request didn't finish, so the invitation may have been sent. Check the list.";
export const RESEND_FAILURE = "Couldn't re-send the invitation. Try again.";
export const REVOKE_FAILURE = "Couldn't revoke the invitation. Check the list before trying again.";
export const INVITATION_NOT_PENDING_MESSAGE = "That invitation is no longer pending.";
/** The function's 60-second cooldown between invitation emails to one address. */
export const RESEND_TOO_SOON_MESSAGE = "An invitation was sent less than a minute ago. Wait a minute, then re-send.";
