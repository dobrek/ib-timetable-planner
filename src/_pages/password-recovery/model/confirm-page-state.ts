import { type EmailLink, type EmailLinkType, parseEmailLink } from "./email-link";
import { forgotPath } from "./forgot-page-state";

/**
 * The `/auth/confirm` vocabulary, in one place, as `forgot-page-state.ts` is for `/auth/forgot`:
 * the spend endpoint builds a failed link's redirect with `confirmFailurePath`, and the page reads
 * its state back with `confirmPageState`.
 *
 * - `link`: a well-formed link, waiting for the person to press Continue.
 * - `invite-failed`: an invitation link GoTrue refused (`expired`: used, replaced, revoked or past
 *   its lifetime, one `otp_expired` for all four) or could not check (`retry`). A refused reset
 *   link goes back to `/auth/forgot` instead, where a new one can be requested; an invitee cannot
 *   request one, so the answer is their admin.
 * - `incomplete`: no usable link, and no failure to report.
 */
export type ConfirmFailureReason = "expired" | "retry";

export type ConfirmPageState =
  | { kind: "link"; link: EmailLink }
  | { kind: "invite-failed"; reason: ConfirmFailureReason }
  | { kind: "incomplete" };

/** Where a link GoTrue refused sends the person, by the link's type. */
export function confirmFailurePath(type: EmailLinkType, reason: ConfirmFailureReason): string {
  return FAILURE_PATHS[type](reason);
}

/**
 * Which state `/auth/confirm` renders. A link wins over an error, since it is a fresh attempt. An
 * unknown or hand-edited error reads as `incomplete`.
 */
export function confirmPageState(searchParams: { get(name: string): string | null }): ConfirmPageState {
  const link = parseEmailLink(searchParams);
  if (link) return { kind: "link", link };
  const reason = inviteFailure(searchParams.get("error"));
  return reason ? { kind: "invite-failed", reason } : { kind: "incomplete" };
}

/** The page's title and heading for a state: the link's own words, or the state's. */
export function confirmPageTitle(state: ConfirmPageState): string {
  if (state.kind === "link") return LINK_COPY[state.link.type].title;
  return state.kind === "invite-failed" ? LINK_COPY.invite.title : INCOMPLETE_TITLE;
}

/** What the Continue page says above the button, per link type. */
export const LINK_COPY: Readonly<Record<EmailLinkType, { title: string; lead: string }>> = {
  recovery: {
    title: "Reset your password",
    lead: "Press Continue to sign in and choose a new password. The link works once.",
  },
  invite: {
    title: "Accept your invitation",
    lead: "Press Continue to sign in and choose your password. The link works once.",
  },
};

const INCOMPLETE_TITLE = "Incomplete link";

const FAILURE_PATHS: Readonly<Record<EmailLinkType, (reason: ConfirmFailureReason) => string>> = {
  recovery: (reason) => forgotPath(reason === "expired" ? "link-expired" : "link-retry"),
  invite: (reason) => `/auth/confirm?error=invite-${reason}`,
};

const inviteFailure = (error: string | null): ConfirmFailureReason | null => {
  if (error === "invite-expired") return "expired";
  if (error === "invite-retry") return "retry";
  return null;
};
