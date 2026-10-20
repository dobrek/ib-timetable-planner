// S-402 password recovery: `/auth/forgot` (request a link) and `/auth/confirm` (spend it).
// The route files under `src/pages/` orchestrate through this barrel; .astro page components are
// imported by direct path per the Astro FSD exception.
export { EMAIL_LINK_TYPES, parseEmailLink, type EmailLink, type EmailLinkType } from "./model/email-link";
export {
  forgotPageState,
  forgotPath,
  type ForgotAlert,
  type ForgotPageState,
  type ForgotReason,
} from "./model/forgot-page-state";
export { formatResetReport, type ResetOutcome, type ResetReport } from "./model/reset-outcome";
export { LINK_LIFETIME, RESEND_INTERVAL } from "./model/recovery-policy";
export { requestPasswordReset } from "./api/request-password-reset";
export { verifyEmailLink, type VerifyEmailLinkResult } from "./api/verify-email-link";
