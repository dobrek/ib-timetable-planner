/**
 * How long an emailed link works, from the moment it is sent. GoTrue has one lifetime for every
 * email link (invite, recovery, email change), so this is that one value, in milliseconds for the
 * Users page's "Invitation expired" status and in words for the copy (S-410, Open Roadmap
 * Question 2: 24 hours, with a 10-digit OTP behind every link).
 *
 * It mirrors values set outside this file, and every mirror changes together:
 *
 * - hosted `mailer_otp_exp = 86400`, set by hand (`docs/runbooks/hosted-auth-settings.md`);
 * - local `otp_expiry = 86400` in `supabase/config.toml`;
 * - the copy in `supabase/templates/recovery.html` and `supabase/templates/invite.html`.
 */
export const EMAIL_LINK_LIFETIME_MS = 86_400_000;

export const EMAIL_LINK_LIFETIME = "24 hours";
