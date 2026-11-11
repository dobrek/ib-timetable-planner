import { EMAIL_LINK_LIFETIME } from "@/shared/config";

/**
 * The two durations the reset copy promises, in words. Each mirrors a hosted Auth value set by
 * hand, and the email template says the same thing:
 *
 * - `LINK_LIFETIME` is the shared `EMAIL_LINK_LIFETIME` (`src/shared/config/email-link-lifetime.ts`),
 *   which names its mirrors: hosted `mailer_otp_exp = 86400`, local `otp_expiry`, and both templates.
 * - `RESEND_INTERVAL` ↔ `smtp_max_frequency = 300`. Locally it is `max_frequency = "1s"` so the
 *   suites run fast; the copy states the hosted value.
 *
 * Changing either hosted value means changing the constant and the templates in the same change —
 * `docs/runbooks/hosted-auth-settings.md` records the coupling beside each row.
 */
export const LINK_LIFETIME = EMAIL_LINK_LIFETIME;

export const RESEND_INTERVAL = "5 minutes";
