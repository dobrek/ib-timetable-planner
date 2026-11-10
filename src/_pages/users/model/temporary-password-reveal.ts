/**
 * The one-time reveal's state: who the password is for, and the password. Held in the Users page's
 * component state only, never in storage, a URL or a log, and set back to `null` when the dialog
 * closes, so closing is the only way it goes and it cannot be recovered afterwards.
 */
export type PasswordReveal = { email: string; password: string };
