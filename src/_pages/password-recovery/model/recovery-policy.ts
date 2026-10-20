/**
 * The two durations the reset copy promises, in words. Each mirrors a hosted Auth value set by
 * hand, and the email template says the same thing:
 *
 * - `LINK_LIFETIME` ↔ `mailer_otp_exp = 3600` (local `otp_expiry`), and `supabase/templates/recovery.html`.
 * - `RESEND_INTERVAL` ↔ `smtp_max_frequency = 300`. Locally it is `max_frequency = "1s"` so the
 *   suites run fast; the copy states the hosted value.
 *
 * Changing either hosted value means changing this file and the template in the same change —
 * `docs/runbooks/hosted-auth-settings.md` records the coupling beside each row.
 */
export const LINK_LIFETIME = "1 hour";

export const RESEND_INTERVAL = "5 minutes";
