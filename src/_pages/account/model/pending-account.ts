/**
 * Why an account is pending: fenced until the person chooses a password of their own (S-409's
 * `must_change_password`, which S-410's invitees carry too).
 *
 * - `invitation`: an admin invited them by email (their directory row records `invited_at`).
 * - `temporary_password`: an admin created the account and gave them a temporary password.
 */
export type PendingKind = "invitation" | "temporary_password";

export function pendingKindOf(invitedAt: string | null): PendingKind {
  return invitedAt === null ? "temporary_password" : "invitation";
}

/**
 * Where the password form goes after a save. A pending account's first password lands in the app:
 * the save clears the fence, so the dashboard opens with the role. If the flag did not clear, the
 * middleware sends the person back to `/account`, which is the safe direction. Any later change
 * reloads the account page, which reports it.
 */
export function passwordSavedPath(isFirstPassword: boolean): string {
  return isFirstPassword ? "/dashboard" : "/account?saved=password";
}
