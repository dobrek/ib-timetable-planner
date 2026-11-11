# S-410 Phase 1 probe — GoTrue behaviour on the local stack

- **Date:** 2026-11-11
- **GoTrue:** v2.196.0 (`/auth/v1/health`), the local stack restarted from this worktree with `otp_expiry = 86400`, `otp_length = 10` and the new `[auth.email.template.invite]`
- **Schema:** before the S-410 migration (the clear trigger still fires on any `encrypted_password` change)
- **Method:** S-409's spike method. A throwaway Node script in the session scratchpad (never committed) drove the Admin API with the local secret key and a publishable-key client. It read `auth.users` and `user_directory` over the local Postgres connection and read mail through Mailpit's API. Every user was deleted at the end, and its mail was deleted by id.

## Results

| #   | Behaviour                                                                    | Expected (research)                                    | Observed                                                                                                                                                                                                                                                  | Verdict |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P1  | `generateLink({ type: "invite" })` on a new address                          | Creates an unconfirmed user with `invited_at`; no mail | User created, `invited_at` set, `confirmation_sent_at` set, `email_confirmed_at` null. **0 messages** in Mailpit after 2 s. `properties` holds `action_link`, `email_otp`, `hashed_token`, `redirect_to`, `verification_type: "invite"`                     | ✅      |
| P2  | `inviteUserByEmail` on that user                                             | Re-send path: one email, new token, old link dies      | Same user id. **1 message**, subject "You're invited to IB Planner", link `http://localhost:4321/auth/confirm?token_hash=<56 hex>&type=invite`. The email's token differs from `generateLink`'s, which now answers **403 `otp_expired`**                      | ✅      |
| P2  | `invited_at` on re-send                                                      | Set to now                                             | `invited_at` and `confirmation_sent_at` both moved to the send time. The function's cooldown can read `invited_at`                                                                                                                                       | ✅      |
| P2  | A second immediate `inviteUserByEmail`                                       | Not throttled                                          | No error, a **second message** arrived. The first email's token then answers **403 `otp_expired`**: only the newest link works                                                                                                                           | ✅      |
| P3  | `verifyOtp({ type: "invite" })` for a flagged invitee with a role, today's schema | Clears the flag (C2 reproduced)                     | Verify succeeded. `encrypted_password` **was written** by the verify, `email_confirmed_at` set, flag **true → false**, and the new session's `own_app_role` answered **`viewer`** before any password was chosen. **C2 reproduced: the fence fails open** | ✅      |
| P4  | `resetPasswordForEmail` for an unconfirmed, flagged invitee                   | Sends a recovery mail; spending it confirms, no password write | 1 message, link `type=recovery`. Verify succeeded, `email_confirmed_at` set, `encrypted_password` **unchanged** (still empty), flag **still true**                                                                                                      | ✅      |
| P5  | Invite to a confirmed account's address                                      | `email_exists` or `user_already_exists`                | `inviteUserByEmail` and `generateLink` both return **422 `email_exists`** ("A user with this email address has already been registered"). 0 messages                                                                                                    | ✅      |
| P5b | `inviteUserByEmail` on an invitee who accepted (confirmed by the invite link) | Refused (plan: no re-send once accepted)               | **422 `email_exists`**                                                                                                                                                                                                                                    | ✅      |

## What this settles for the plan

- **Send last works as designed.** `generateLink` creates and sends nothing, and the email `inviteUserByEmail` sends is the only live link. The `hashed_token` that `generateLink` returns is dead from that moment on, so even a leaked one would be useless.
- **The narrowed trigger is needed.** P3 shows the random-password write on acceptance clears the flag. After the migration, the same sequence must leave the flag set (`invitation-acceptance.integration.test.ts`).
- **Recovery for an unconfirmed invitee never writes a password** (P4), so it never fires the clear trigger, before or after the migration. The person stays fenced until they choose a password.
- **One refusal code.** The function maps `email_exists` (422) from either call to its own 409 `email_exists`, the same mapping `create` uses.
- **The cooldown can read `invited_at`.** It moves on every send, through the mirror the migration adds.

No result contradicts the research.
