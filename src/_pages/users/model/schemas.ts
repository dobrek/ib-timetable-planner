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

/** The form adds the typo guard: the address is typed twice, since deleting a wrong account is S-411. */
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

/** What the function reveals, once: carried in memory only, never stored, logged or put in a message. */
export type TemporaryPassword = { userId: string; password: string };
