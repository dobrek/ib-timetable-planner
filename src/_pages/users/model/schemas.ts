import { z } from "zod";
import { APP_ROLE_VALUES } from "@/shared/config";

/**
 * One role change from the Users page. `role: null` is "No access", which removes the role row.
 * The actor is never part of the input: the recording trigger reads it from the session.
 */
export const changeUserRoleInput = z.object({
  userId: z.uuid(),
  role: z.enum(APP_ROLE_VALUES).nullable(),
});

export type ChangeUserRoleInput = z.output<typeof changeUserRoleInput>;

/**
 * Deactivate a user (`active: false`) or reactivate them (`active: true`), S-408. Their role is kept
 * either way. As with a role change, the actor is read from the session.
 */
export const setUserActiveInput = z.object({
  userId: z.uuid(),
  active: z.boolean(),
});

export type SetUserActiveInput = z.output<typeof setUserActiveInput>;

// Trimmed and lower-cased, as the function does, so the address the admin confirms is the one stored.
const emailField = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

/**
 * A new account (S-409): an address and the role it starts with (`null` is "No access"). There is
 * no password: the function generates it, so a person's password is never typed by an admin.
 */
export const createAccountInput = z.object({
  email: emailField,
  role: z.enum(APP_ROLE_VALUES).nullable(),
});

export type CreateAccountInput = z.output<typeof createAccountInput>;

/** The form adds the typo guard: the address is typed twice. */
export const createAccountFormSchema = createAccountInput
  .extend({ confirmEmail: emailField })
  .refine(({ email, confirmEmail }) => email === confirmEmail, {
    path: ["confirmEmail"],
    message: "The two addresses don't match.",
  });

export type CreateAccountFormValues = z.input<typeof createAccountFormSchema>;
export type CreateAccountFormOutput = z.output<typeof createAccountFormSchema>;

/** Re-issue the temporary password of one pending account. */
export const reissuePasswordInput = z.object({ userId: z.uuid() });

export type ReissuePasswordInput = z.output<typeof reissuePasswordInput>;

/**
 * An invitation by email (S-410): an address and the role it grants once the person has chosen a
 * password. A role is required: an invitation with "No access" would land the colleague nowhere.
 * Typed once: a mistyped invitation is revoked from the list.
 */
export const inviteUserInput = z.object({
  email: emailField,
  role: z.enum(APP_ROLE_VALUES),
});

export type InviteUserInput = z.output<typeof inviteUserInput>;
export type InviteUserFormValues = z.input<typeof inviteUserInput>;

/** One pending invitation, to re-send or revoke. */
export const invitationTargetInput = z.object({ userId: z.uuid() });

export type InvitationTargetInput = z.output<typeof invitationTargetInput>;

/** What the function reveals, once: carried in memory only, never stored, logged or put in a message. */
export type TemporaryPassword = { userId: string; password: string };

/** What an invite answers: the account, and whether it re-sent an invitation that was still pending. */
export type InvitationSent = { userId: string; resent: boolean };

/** What a re-send or a revoke answers: the account it acted on. */
export type InvitationTarget = { userId: string };

/** Ban, unban or delete one account. The actor is the session, never the input. */
export const accountTargetInput = z.object({ userId: z.uuid() });

export type AccountTargetInput = z.output<typeof accountTargetInput>;

/**
 * A new address for an account (S-411). The confirmation is the form's typo guard and is not sent:
 * the action checks the address alone.
 */
export const changeUserEmailInput = z.object({
  userId: z.uuid(),
  email: emailField,
});

export type ChangeUserEmailInput = z.output<typeof changeUserEmailInput>;

export const changeUserEmailFormSchema = z
  .object({ email: emailField, confirmEmail: emailField })
  .refine(({ email, confirmEmail }) => email === confirmEmail, {
    path: ["confirmEmail"],
    message: "The two addresses don't match.",
  });

export type ChangeUserEmailFormValues = z.input<typeof changeUserEmailFormSchema>;
export type ChangeUserEmailFormOutput = z.output<typeof changeUserEmailFormSchema>;

/** What a ban, an unban, a delete or an email change answers: the account it acted on. */
export type AccountTarget = { userId: string };

/**
 * The one-time reveal's state: who the password is for, and the password. Held in the Users page's
 * component state only, never in storage, a URL or a log, and set back to `null` when the dialog
 * closes, so closing is the only way it goes and it cannot be recovered afterwards.
 */
export type PasswordReveal = { email: string; password: string };
