---
date: 2026-11-10T21:59:17+01:00
researcher: Claude (Opus 5.5)
git_commit: da96a97b8699fa64bd4e14b48d1188ff5e18425d
branch: s-410-invite-a-colleague-by-email-confirm
repository: ib-timetable-planner
topic: "Feasibility of S-410: an admin invites a colleague by email; the colleague confirms, sets a password and lands with the chosen role"
tags: [research, codebase, auth, invite, email-link, users, edge-function, admin-users, gotrue, must-change-password, access-changes, invite-by-email]
status: complete
last_updated: 2026-11-10
last_updated_by: Claude (Opus 5.5)
---

# Research: Feasibility of S-410, invite a colleague by email

**Date**: 2026-11-10T21:59:17+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`da96a97`](https://github.com/dobrek/ib-timetable-planner/tree/da96a97b8699fa64bd4e14b48d1188ff5e18425d)
**Branch**: s-410-invite-a-colleague-by-email-confirm
**Repository**: ib-timetable-planner

## Research Question

> Please check the feasibility of implementing this feature, list the challenges that we could face, and name options that we have to address those.

The feature is roadmap slice **S-410**, the milestone's north star ([`roadmap.md:252-263`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/roadmap.md#L252-L263), issue [#151](https://github.com/dobrek/ib-timetable-planner/issues/151); PRD FR-401, FR-402, FR-404 (revoke), FR-418, US-401). An admin invites a colleague by email with a role chosen up front. The colleague confirms on a page that needs a deliberate click, sets a password, and lands with that role. The admin sees them in the Users list and can re-send or revoke a pending invitation. An expired or used link says "ask your admin to re-send". Inviting an address that already has an account is refused, with no duplicate.

## Summary

**Verdict: feasible, with no technical blocker.** Each prerequisite has retired its own risk:
- S-402: the scanner-safe link flow and the sender.
- S-405: the read-only landing.
- S-409: the secret-holding `admin-users` function, the `must_change_password` fence, and the Users-page actions.

S-410 is mostly reuse. It adds three operations to the existing function, one link type, one email template, one status on the Users page, and a small migration. **No new public route, no new function, no CI stack change, and no new secret are needed.**

**The one hard blocker is a decision, not code:** the email-link lifetime ([Open Roadmap Question 2](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/roadmap.md#L317)). GoTrue still has a single lifetime for every email link, at every version up to `master` on 2026-11-10. "Invite 72 h, reset 1 h" cannot both hold with platform links. See [§ Link lifetime options](#link-lifetime-options-open-roadmap-question-2).

**Four findings that change the plan's shape:**

1. **The S-409 fence fails open on invite acceptance.** When an invitee spends the link, GoTrue's `signupVerify` writes a random 64-character password ([`verify.go:317-338`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L313-L348)) before it confirms the email. That write fires `user_directory_clear_must_change_password` ([`must_change_password.sql:120-124`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L120-L124)). The flag clears and the role goes live before the person has chosen a password. A one-line narrowing of the trigger's `WHEN` fixes it ([C2](#c2-the-fence-fails-open-on-acceptance)).
2. **Without the fence, an invited admin counts toward the last-admin rule.** `guard_last_admin()` counts every admin who is not flagged. An admin who demotes themselves would leave only someone who never accepted ([C3](#c3-an-invited-admin-counts-as-an-active-admin)). The fence fixes this too, which is a second reason to keep it.
3. **Nothing throttles a re-send.** `sendInvite` skips the 300 s per-user interval. The project-wide email cap is dormant under `mailer_autoconfirm`. The only limit is Resend's 100 emails per UTC day, shared with password resets. The app must throttle re-sends itself ([C6](#c6-nothing-throttles-a-re-send)).
4. **An invitation outlives its link.** GoTrue mails a recovery link to an unconfirmed user, and spending it confirms them ([`verify.go:378-387`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L378-L387)). So an invitee whose link expired can claim the account through "Forgot password". The lifetime the PRD names is the link's, not the invitation's. Revoke is the only account-level stop ([C8](#c8-an-invitation-outlives-its-link)).

**One correction to the roadmap:** S-410 does **not** need to widen the public-route allowlist ([`roadmap.md:262`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/roadmap.md#L262) expects one more widening). `/auth/confirm` and the `/api/auth/` prefix already cover acceptance, and `/account` is already role-exempt ([C12](#c12-routes-no-new-public-route)).

**Challenges, most consequential first:**

| #   | Challenge                                              | Failure if ignored                                                         | Recommended option                                                                             | Confidence            |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------- |
| C1  | One lifetime for every email link (ORQ 2)              | The slice cannot be planned; UI copy contradicts the platform              | (a) one 24 h lifetime, OTP length 10, amend the PRD guardrail                                  | Source + docs         |
| C2  | The fence fails open on acceptance                     | Role live before a password is chosen; a pending admin becomes "active"    | Reuse the fence; narrow the clear trigger to `old.email_confirmed_at is not null`              | Source                |
| C3  | An invited admin counts as an active admin             | The school is left with an admin who never accepted                        | Set the flag at invite (falls out of C2)                                                       | Code                  |
| C4  | No "Invited" state in the directory                    | Invitee shows as "Active" or "Temporary password"                          | Mirror `invited_at` and `email_confirmed_at` into `user_directory`                             | Code                  |
| C5  | Invite is not atomic                                   | A dead link in the inbox after a rolled-back invite                        | `generateLink(invite)` → flag, record, grant → `inviteUserByEmail` sends last                 | Source                |
| C6  | Nothing throttles a re-send                            | Repeated clicks spend the 100/day Resend quota and block resets            | App-level cooldown from `invited_at`, in the function                                          | Source                |
| C7  | Invite, re-invite and "already exists" semantics       | Silent re-send, wrong message, or a role mismatch                          | Check the directory first; map each case to its own status                                    | Source + code         |
| C8  | An invitation outlives its link                        | The PRD's "stops working after N h" reads as an account property           | Accept and document; revoke is the account-level stop                                          | Source                |
| C9  | Revoke deletes the target the record names             | "Who revoked whose invitation" is lost                                     | Accept a target-less record (S-406's no-email rule); decide jointly with S-411                | Code                  |
| C10 | Failure copy is reset-specific                         | An invitee is told to "request a new one below" on the reset form          | Type-aware failure states; one message for expired and used                                    | Code + source         |
| C11 | Spending a link replaces the browser's session         | An admin testing an invite is silently switched to the invitee             | Warn on the confirm page when a session exists; fresh context in e2e                           | Code + SDK source     |
| C12 | Routes: no new public route                            | An unneeded allowlist widening                                             | Land on `/account?notice=invite`; record the non-widening                                      | Code                  |
| C13 | The hosted template must exist before the feature does | Production sends GoTrue's default `ConfirmationURL` link (S-402's lesson)  | Sync the template on hosted and send one real email before merge                              | Recorded lesson       |
| C14 | The 6-digit OTP behind every `token_hash`              | A longer lifetime widens a brute-force window that already exists          | `mailer_otp_length` 10 (hosted) / `otp_length = 10` (local)                                    | Source; keying unverified |
| C15 | Smaller UX gaps                                        | "Password changed" email on the first password; reissue accepts invitees  | Accept the email; refuse reissue for invitees                                                  | Code + source         |
| C16 | Hosted behaviour and the done-line demo                | Green CI, but hosted differs; M365 Safe Links not yet proven               | Hosted check with a throwaway invite; the done-line demo closes S-402's deferred M365 check   | Open until run        |
| C17 | Overlap with S-408 and S-411                           | One slice reverts another's function or trigger body                       | Touch only the clear trigger and the mirror; re-create from the latest live bodies             | Recorded rule         |

"Source" means read in GoTrue source at v2.196.0 (local and CI) and compared with v2.197.0 (hosted on 2026-11-09) and `master`. "Code" means read in this repo. No live probe was run for this research ([§ Not verified](#not-verified)).

## Recommended design

```
Users page island (admin)
  └─ Invite dialog: email + role   (primary control; Create account stays the fallback)
       └─ Astro Action, requires: manage_users       courier only: no secret, no new Worker env
            └─ functions.invoke("admin-users", { op: "invite", email, role })
                 ├─ requireAdmin (live own_app_role = 'admin')    unchanged
                 ├─ directory lookup by email:
                 │     pending invitation → treat as re-send (FR-401)
                 │     confirmed / temporary-password / machine → 409 email_exists
                 ├─ admin.generateLink({ type: "invite", email })   creates the user, sends nothing
                 ├─ firstFailure:
                 │     flag    user_directory.must_change_password = true   (secret key)
                 │     record  access_changes 'invitation_sent', actor = admin  (secret key)
                 │     grant   insert user_roles under ctx.supabase → S-406 records role_granted
                 ├─ on failure: deleteUser → 500 (no email was sent)
                 └─ admin.inviteUserByEmail(email)   re-send path: new token, email goes out LAST
                      └─ 200 { userId }   (no password in the body)

Invite email (supabase/templates/invite.html)
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
GET  /auth/confirm            renders Continue, no side effects               unchanged, gains invite copy
POST /api/auth/confirm        verifyOtp({ type: "invite", token_hash })       unchanged
       ├─ GoTrue writes a random password, then confirms
       │     clear trigger skips it: old.email_confirmed_at is null           ← the one SQL change
       └─ 303 /account?notice=invite   (fenced: password_change_required)
/account: choose a password (no current-password rule)
       └─ the trigger clears the flag → current_app_role() returns the role → "Continue to the planner"
```

What it reuses unchanged:
- The admin gate, the two identities, `firstFailure` / `discard`, and the `email_exists` → 409 mapping in `admin-users`.
- The fence: `current_app_role()`, `guard_last_admin()`, the middleware's `password_change_required`, and the role matrix's `pendingAdmin` principal.
- The scanner-safe confirm page and POST.
- `/account`'s password form.
- Mailpit and edge-runtime in CI, already kept for S-402 and S-409.

## Detailed Findings

### 1. The email-link flow (S-402) generalizes, with copy and failure routing to fix

- **The link shape is fixed.** The template builds `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` ([`recovery.html:15`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/templates/recovery.html#L15)). The GET page renders a native form with no side effects. Only `POST /api/auth/confirm` spends the link, through `verifyOtp({ token_hash, type })`.
- **`type` is allow-listed.** It must be in `EMAIL_LINK_TYPES = ["recovery"]` ([`email-link.ts:7`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/email-link.ts#L7)). Adding `invite` there and in `LANDING_PATHS` ([`:36-38`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/email-link.ts#L36-L38)) is the documented extension point. `email-link.test.ts:27-32` currently asserts `invite` is refused, so that assertion flips.
- **The file's comment overstates it.** It says "nothing else needs to change" ([`email-link.ts:2-5`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/email-link.ts#L2-L5)). Every failure redirects to the reset form ([`confirm.ts:22,36`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/pages/api/auth/confirm.ts#L17-L37)), where the copy says "Request a new one below". The confirm page's heading and copy, the invalid-link fallback, and the account-page banners are recovery-specific too. Per the lesson on conventions coupled to mechanisms, that comment should be corrected in the same change.
- **After a successful spend**, the person lands on `/account?notice=recovery`. `/account` is role-exempt ([`role-gate.ts:37`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/shared/config/role-gate.ts#L37)). Its password form needs no current password (S-401 dropped that rule). After saving it stays on `/account?saved=password`; nothing sends the person on to the planner.
- **Guards on the POST.** Only `POST` is exported. Astro's `checkOrigin` refuses cross-site posts. GoTrue's `token_verifications = 30` per 5 minutes applies ([`config.toml:198`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/config.toml#L198)). There is no Turnstile (deliberately).
- **Reusable test helpers.** `src/test/mailpit.ts` (`waitForMessageTo`, `readMessage`, `deleteMessages`) and `src/test/email-links.ts` (`linkIn`). In e2e: the spec-local `confirmLinkIn` / `signIn` in `e2e/specs/forgot-password-unauth.spec.ts:108-119`, which are candidates for `e2e/support/`, and the fresh-context pattern in `create-account.admin.spec.ts`.

### 2. The `admin-users` function (S-409) takes three more ops without restructuring

- **Routing.** `handle` routes by a two-way ternary ([`handler.ts:43-45`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/functions/admin-users/handler.ts#L43-L45)), which becomes a switch. `requireAdmin` runs before the body is read or the secret-key client is touched, and it refuses the solver's machine token with 42501 → 403.
- **`create`** calls `createUser({ email, password, email_confirm: true })` ([`handler.ts:57`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/functions/admin-users/handler.ts#L57)). It then runs flag → record → grant through `firstFailure` and rolls back by `deleteUser`. `invite` follows the same pattern with a different first step and a different last step ([C5](#c5-invite-is-not-atomic)).
- **`reissue`** judges "pending" by the flag alone. Once invitees carry the flag, it would accept them too ([C15](#c15-smaller-ux-gaps)).
- **The Worker courier is typed to the password.** `invoke-admin-users.ts` returns `TemporaryPassword`, and `revealed()` treats a body without a password as "outcome unknown". So it needs a per-op result type. The error tables (`account-error.ts`) are two-way ternaries on the operation, and the UI reads status codes only. Every outcome that needs its own message needs its own status: already has an account, already invited (re-sent), rate-limited, not an invitation.
- **Request parsing** accepts exact keys only (`request.ts`), so `app_metadata` and user metadata cannot be smuggled in. Keep it that way. The role must never travel in the invite's `data` (user metadata), because users can edit it. It belongs in `user_roles` behind the fence.

### 3. Database: what exists, and the smallest migration

- **`user_directory`** mirrors only `user_id`, `email`, `is_machine` and `is_service_account` ([`user_directory.sql:57-62`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105073614_user_directory.sql#L57-L62)), plus S-409's `must_change_password`. Its triggers are AFTER INSERT, and AFTER UPDATE OF `email, raw_app_meta_data` ([`:121-133`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105073614_user_directory.sql#L121-L133)). An invitee appears in the list as soon as GoTrue inserts them. Their status today would read "Active", or "Temporary password" once flagged ([C4](#c4-no-invited-state-in-the-directory)).
- **The fence.**
  - `current_app_role()` returns null while the flag is set ([`must_change_password.sql:69-85`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L69-L85)).
  - The clear trigger fires `when (old.encrypted_password is distinct from new.encrypted_password)` ([`:120-124`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L120-L124)).
  - `guard_last_admin()` counts only unflagged admins ([`:128-179`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L128-L179)).
- **`access_changes.kind`** is an enum ([`role_management.sql:190`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105080343_role_management.sql#L190)). The migration that created it anticipates S-410 adding its kinds with `alter type … add value` (`:62`). S-409 did exactly that for `account_created` and `password_reissued`. That is additive and safe on live data. Candidates: `invitation_sent`, `invitation_resent`, `invitation_revoked`.
- **The cascade on deleting a user.** When an auth user is deleted, the cascaded `user_roles` delete is deliberately not recorded ([`role_management.sql:251-255`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105080343_role_management.sql#L251-L255)). The user's existing records keep their rows, with `target_id` set to null. The Users-page loader drops null-target records ([`loader.ts:26-27`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/users/api/loader.ts#L26-L27)).

**The smallest migration S-410 needs:**
1. Three enum values.
2. `create or replace trigger user_directory_clear_must_change_password` with the narrowed `WHEN` ([C2](#c2-the-fence-fails-open-on-acceptance)).
3. `invited_at` and `email_confirmed_at` on `user_directory`: re-create `private.mirror_auth_user()` and extend the update trigger's column list ([C4](#c4-no-invited-state-in-the-directory)).

Then `pnpm db:types`. None of it touches `current_app_role()` or `guard_last_admin()`, which keeps S-410 clear of S-408 ([C17](#c17-overlap-with-s-408-and-s-411)).

### 4. GoTrue behaviour (v2.196.0 local and CI, v2.197.0 hosted, compared with `master`)

| Behaviour                         | Finding                                                                                                                                                                                                                                                                                                       | Where                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Invite, no user                   | Creates the user with password `''` and `data` as user metadata, then sends the email                                                                                                                                                                                                                        | `invite.go:45-64`                                                                             |
| Invite, unconfirmed user          | **Re-sends** with a new token; the old link dies. `invited_at` and `confirmation_sent_at` are set to now. `data` is not updated                                                                                                                                                                                | `mail.go:359-384`, `one_time_token.go:127-139`                                                |
| Invite, confirmed user            | 422 `email_exists`. S-409's accounts (`email_confirm: true`) and machine users fall here                                                                                                                                                                                                                       | `invite.go:68-69`                                                                             |
| Signups disabled                  | Invites still work (`DisableSignup` is checked only in `/signup`)                                                                                                                                                                                                                                              | `signup.go:115`                                                                               |
| Per-user resend interval          | **Not applied to invites**; recovery and confirmation have it                                                                                                                                                                                                                                                | `mail.go:325,401` vs `sendInvite`                                                             |
| Project-wide email cap            | Skipped while `mailer_autoconfirm` is true (hosted: true)                                                                                                                                                                                                                                                   | `mail.go:803-813`; [`hosted-auth-settings.md:47-48`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/docs/runbooks/hosted-auth-settings.md#L47-L48) |
| Spending an invite link           | `signupVerify` sets a random 64-character password (`UpdatePassword`, which also nulls every `*_sent_at`) **before** `Confirm` sets `email_confirmed_at`, all in one transaction. Identical at v2.196.0, v2.197.0 and `master`                                                                                  | [`verify.go:313-348`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L313-L348) |
| Lifetime                          | One `mailer_otp_exp` for every link type, counted from `confirmation_sent_at` for invites. Above 86,400 s is "strongly discouraged" and Management-API-only. `master`'s new `one_time_tokens.expires_at` (#2766) keeps one value for every type                                                                | `verify.go:675-689`; Supabase docs (`auth-email-passwordless`, `users#inviting-users`)       |
| Expired, used, replaced, deleted  | All return 403 `otp_expired`; a client cannot tell them apart                                                                                                                                                                                                                                                 | `verify.go:662-664,693-694`                                                                   |
| Recovery for an unconfirmed user  | `/recover` mails any known address. `recoverVerify` confirms the user and sets no password. On `master`, `ClearUnconfirmedPassword` (#2887, 2026-10-30) also nulls a password, which would fire the clear trigger too                                                                                        | `recover.go:52-75`, `verify.go:378-387`                                                       |
| `generateLink(invite)`            | Creates the user if missing and sets `invited_at`. **Sends no email.** Returns `hashed_token`; `action_link` is a GET that spends the token, so it must never be emailed                                                                                                                                     | `mail.go:52-316`                                                                              |
| `deleteUser`                      | Hard delete by default; `one_time_tokens` cascade, so the link then gets `otp_expired`                                                                                                                                                                                                                         | `admin.go:582,627`                                                                            |
| Token entropy                     | `token_hash = sha224(email + otp)`, with a 6-digit OTP by default (range 6 to 10)                                                                                                                                                                                                                              | [`crypto.go:45-47`](https://github.com/supabase/auth/blob/v2.196.0/internal/crypto/crypto.go#L45-L47), `configuration.go:1175`; [`config.toml:226`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/config.toml#L226) |
| Hooks                             | The Send Email Hook replaces delivery only, so expiry is still `OtpExp`. Before-User-Created adds nothing over the admin gate                                                                                                                                                                                 | `mail.go:815-874`                                                                             |

GoTrue paths are under `internal/api/` and `internal/models/` at [`supabase/auth@v2.196.0`](https://github.com/supabase/auth/tree/v2.196.0); line numbers are at that tag.

## Challenges and options

### C1. One lifetime for every email link

See [§ Link lifetime options](#link-lifetime-options-open-roadmap-question-2). This is the slice's only blocking decision, owned by the user ([`roadmap.md:261`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/roadmap.md#L261)).

### C2. The fence fails open on acceptance

**What happens.**
1. `signupVerify` runs `UpdatePassword` (a random password, `''` → hash) while `email_confirmed_at` is still null, then `Confirm`.
2. The clear trigger's `IS DISTINCT FROM` is satisfied, so it clears the flag.
3. `current_app_role()` returns the role the moment the person presses Continue.

The middleware never forces them to `/account`. They hold a session and a role but know no password. If they leave, the only way back is "Forgot password".

**Options.**
- **(A) Reuse the fence and narrow the trigger (recommended).** `when (old.encrypted_password is distinct from new.encrypted_password and old.email_confirmed_at is not null)`.
  - GoTrue's own write happens while `old.email_confirmed_at` is null, so the trigger skips it. That holds even if a future version folds both updates into one statement, because `old` is the pre-update row.
  - Every later password write clears the flag as today: the person's own choice (they are confirmed by then), a reissue, or a recovery followed by a choice.
  - It also hardens against `master`'s `ClearUnconfirmedPassword`.
  - S-409's accounts are created confirmed, so they behave exactly as now.
  - The cost is one `create or replace trigger` plus an integration test that pins the order (spend an invite → flag still set → choose a password → flag clear) and a hosted check.
- **(B) Reuse the fence and accept that it lifts on acceptance.** The guard still excludes invitees before acceptance, which is the important half. But the role goes live before a password exists, and the PRD's "sets a password" becomes a UX redirect only. There is no SQL change, but "pending" means two different things.
- **(C) No fence for invitees.** This needs a separate "unconfirmed" condition in `guard_last_admin()`, which means re-creating it. That collides with S-408, and every flaw of (B) remains.

### C3. An invited admin counts as an active admin

An invitee with a role row and no flag counts in `guard_last_admin()` (`:158-170`). Setting the flag at invite time fixes this with no guard change. That is the second reason for C2 (A). Under C2 (C), the guard itself must change.

### C4. No "Invited" state in the directory

The UI cannot tell an invitation from a temporary password, or a pending invitation from an expired one.

**Options.**
- **Mirror `invited_at` and `email_confirmed_at` (recommended).** They come from GoTrue, the source of truth, and the derived states fall out of them:

  | State                              | Condition                                                |
  | ---------------------------------- | -------------------------------------------------------- |
  | Invited                            | `invited_at` set and `email_confirmed_at` null           |
  | Link expired                       | Invited, and `invited_at` + lifetime has passed          |
  | Accepted, choosing a password      | Confirmed and flagged                                    |
  | Temporary password                 | Flagged, and `invited_at` null                           |
  | Active                             | Unflagged                                                |

  The cost is re-creating `private.mirror_auth_user()`, which must never raise, and the update trigger's column list (`create or replace trigger`, no DROP). S-411's email change touches the same mirror, so whichever lands second re-creates it from the live body.
- **A column the function writes** (`invited_at` set by the secret-key client on invite and re-send). It doesn't touch the mirror, but it can't see acceptance (`email_confirmed_at`), so "expired" stays wrong after someone has accepted.
- **Derive it from the latest `access_changes` kind.** Fragile: the record is about who changed what, not about state.

### C5. Invite is not atomic

`inviteUserByEmail` creates the user and sends the email in one call. A later failure in flag, record or grant rolls back by `deleteUser`, which leaves a dead link in the inbox. That is the email equivalent of revealing a password too early.

**Options.**
- **Send last (recommended).** `generateLink({ type: "invite" })` creates the unconfirmed user without sending. Then run flag → record → grant. Then call `inviteUserByEmail` on the same address, which takes GoTrue's re-send path and sends the only live link. This mirrors S-409's "reveal last" and costs one extra GoTrue call.
- **Accept it.** It is rare, and the recipient sees "expired or used".

### C6. Nothing throttles a re-send

Each re-send replaces the live link and spends one of Resend Free's 100 emails a day, which password resets share ([`email-delivery.md:70-75`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/docs/runbooks/email-delivery.md#L70-L75)).

**Options.**
- **A cooldown in the function (recommended).** Read `invited_at` (from the mirror, or `getUserById`) and refuse a re-send inside N seconds with its own status. 300 s mirrors `smtp_max_frequency`; 60 s is friendlier. Disable the button in the UI too.
- **UI-only debounce.** Not enforcement.

### C7. Invite, re-invite and "already exists" semantics

FR-401 says re-inviting a pending address re-sends. GoTrue does this silently, so the function must decide before calling it.

| Address state                                   | Response                                                         | Message                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Pending invitation (unconfirmed)                | Re-send; 200 with `resent: true`                                 | "Invitation re-sent"                                          |
| Confirmed account                               | 409 `email_exists`                                               | Existing "An account with this email already exists"         |
| Temporary-password account                      | 409 `email_exists`                                               | Could point at "Re-issue password" instead                    |
| Accepted invitation, password not yet chosen    | 409 (invite gets 422 `email_exists`)                             | The person can use "Forgot password"; or allow a reissue      |

- **A re-invite with a different role** is a decision. Either update the role under the admin's session, recorded as `role_changed`, or refuse the mismatch.
- **Two concurrent first invites** race: the second insert hits the unique email index and gets a 500. Rare. Map it to "try again".

### C8. An invitation outlives its link

Recovery works for an unconfirmed invitee and confirms them. So after the link expires, the invitee can still claim the account through "Forgot password" (Turnstile, 300 s interval), with the same mailbox proof a re-send relies on. Under C2 (A) they stay fenced until they choose a password, and land with their role.

**Options.**
- **Accept and document (recommended).** State that the lifetime is the link's, and that revoke is the only account-level stop. Optionally mention "Forgot password" in the expired-invite copy.
- **Enforce an invitation expiry in the database.** For example, `current_app_role()` returns null for an invitee past 72 h. That touches the one DEFINER function (S-408 collides) and needs the mirror. Not worth it for a handful of invitations.

### C9. Revoke deletes the target the record names

`revoke` = `deleteUser` on an unconfirmed invitee. That kills the token and cascades the role and directory rows. It must refuse confirmed, flagged-confirmed and machine accounts, which belong to S-411's delete. It needs a re-check against an acceptance landing at the same moment.

The `invitation_revoked` record's `target_id` becomes null on delete, by S-406's design: ids only, never an email, "so no ex-staff member's email is kept" ([`role_management.sql:48-50`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105080343_role_management.sql#L48-L50)). The record keeps who revoked and when, not whose invitation.

**Options.**
- **Accept (recommended for S-410).** The PRD guardrail ("who made it and when") holds.
- **A `target_email` snapshot on removal kinds only.** This reverses a recorded decision, so it needs a reason. S-411's delete faces the same choice, so decide it once, for both.
- **Revoke by ban instead of delete.** It keeps a row, but a banned unconfirmed user blocks re-inviting that address, and it adds a state. Not recommended.

### C10. Failure copy is reset-specific

All failures route to `/auth/forgot` with reset copy ([`confirm.ts:36`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/pages/api/auth/confirm.ts#L36)). GoTrue returns the same `otp_expired` for expired, used, replaced and revoked links. So the invite message must cover all of them, for example: "This invitation link has expired or was already used. If you've already set your password, sign in; otherwise ask your admin to re-send it."

**Options.**
- **Type-aware redirects.** `link.type` is known at `:36`. The malformed branch at `:22` has none and can keep a neutral message. Send invite failures to an error state of `/auth/confirm` itself, which is already public.
- **A new public `/auth/invite-expired` page.** It widens the allowlist for no benefit.

### C11. Spending a link replaces the browser's session

`verifyOtp` saves the new session over the existing cookies, so an admin who opens an invite in their own browser silently becomes the invitee.

**Options.**
- **A warning on the confirm page (recommended, small).** The GET page can read `Astro.locals` and say "You're signed in as X; continuing signs you in as the invited person". No side effect.
- **Accept it.** The e2e and the hosted smoke must use a fresh browser context either way.

### C12. Routes: no new public route

`/auth/confirm` (`middleware.ts:20`) and the `/api/auth/` prefix (`:25`) already cover acceptance. `/account` is role-exempt, so a fenced invitee lands there as a pending S-409 user does.

The PRD's constraint ("the allowlist widens only for invitation acceptance and password reset") is satisfied without a widening. Record that in the plan, and correct the roadmap's risk line. A redirect target is never sent, because the template builds the link from `{{ .SiteURL }}`, so `uri_allow_list` stays unread.

### C13. The hosted template must exist before the feature does

S-402 shipped with production still sending GoTrue's default `{{ .ConfirmationURL }}` template, which scanners spend on GET. Its recorded rule: before merging code that relies on a new hosted template, sync it and read one real email (S-402 `change.md:16-23`).

S-410 needs:
- `supabase/templates/invite.html`, with notes in `{{/* … */}}` and no `{{ .Data }}` (stale on re-send, and user-editable);
- `[auth.email.template.invite]` in `config.toml`;
- `mailer_subjects_invite` and `mailer_templates_invite_content` rows in [`hosted-auth-settings.md`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/docs/runbooks/hosted-auth-settings.md), with its check `jq` and its read-back diff.

The lifetime copy is mirrored in three places: `LINK_LIFETIME` ([`recovery-policy.ts:12`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/recovery-policy.ts#L12)), `recovery.html:16`, and the new invite template. They move together with `mailer_otp_exp`.

### C14. The 6-digit OTP behind every `token_hash`

`token_hash = sha224(email + otp)`. For someone who knows a staff email, the hash in a link has the OTP's entropy (10⁶ with 6 digits), not 224 bits. They can enumerate hashes and POST them to the public `/api/auth/confirm`, limited only by GoTrue's per-IP verification limit. GoTrue sees the Worker's egress address, so how that limit is keyed for this deployment is unverified.

This exists today for resets: an attacker can trigger a fresh reset every 5 minutes. A longer lifetime enlarges the window for the one link an attacker cannot trigger, the invite.

**Option.** Raise `mailer_otp_length` to 10 on hosted and `otp_length = 10` locally ([`config.toml:226`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/config.toml#L226)). Templates never show `{{ .Token }}`, so no copy changes. Pair it with any lifetime above 1 h.

### C15. Smaller UX gaps

- **The first password triggers a "password changed" notification.** An invitee who chooses their first password gets "Your IB Planner password was changed" (S-409 accounts do too). Accept it, or soften the template's copy so it reads true for a first password.
- **`reissue` would accept an invitee**, since "pending" is the flag alone. Recommended: refuse it while `invited_at` is set and the account is unconfirmed (the answer is re-send). An accepted invitee who lost the tab can use "Forgot password".
- **No onward link after the password.** After choosing a password on `/account`, nothing invites the person into the planner. A "Continue to the planner" link on the invite banner closes the loop. The PRD's success flow ends with the person landing read-only.
- **The account-page banner** for flagged users says "An administrator gave you a temporary password" (`AccountPage.astro:32-38`). It needs an invite variant.

### C16. Hosted behaviour and the done-line demo

Local and CI run GoTrue v2.196.0; hosted ran v2.197.0 on 2026-11-09 (S-409 `hosted-check.md:18`). `invite.go` and `signupVerify` are identical across both, but a hosted check with a throwaway invite should confirm two things: the narrowed trigger keeps the flag through acceptance, and the template renders `type=invite`.

The milestone's done-line is this flow on hosted against a real school mailbox ([`roadmap.md:27`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/roadmap.md#L27)). S-402's real M365 / Safe Links check is still deferred (S-402 `smoke.md:76-94`), so the same demo can close both. The coordinator's mailbox sits in the school's tenant, outside the developer's control: an external blocker to schedule early.

### C17. Overlap with S-408 and S-411

- **S-408** will re-create `current_app_role()` and `guard_last_admin()`. The recommended S-410 design touches neither, only the clear trigger and the mirror.
- **S-411** shares `deleteUser`, the record-identity choice (C9), and the mirror (email change).

Whichever slice lands second re-creates any shared function or trigger from the latest live body (lessons.md, "Re-create SQL functions from the latest live definition").

## Link lifetime options (Open Roadmap Question 2)

The PRD guardrail reads "invite 72 h, reset 1 h" ([`prd.md:125`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/prd.md#L125)). The platform offers one value for every link. Local and hosted are both 3600 s today.

| Option                                                       | Invite | Reset | New code                                                                                                                                                                                                                                                                                                                                                              | Security                                                                                     | Fit                                                                                                       |
| ------------------------------------------------------------ | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **(a) One lifetime, 24 h (86,400 s, the dashboard maximum)** | 24 h   | 24 h  | None. Three copy mirrors plus `otp_expiry` / `mailer_otp_exp`                                                                                                                                                                                                                                                                                                         | Reset links live 24 h. The confirm POST already stops scanners, and only the newest link works. Pair with OTP length 10 (C14) | **Recommended.** The health check calls it the smallest change. Re-send covers the rest. Amend the guardrail to "24 h for every email link" |
| (b) App-issued invite tokens with their own 72 h              | 72 h   | 1 h   | A token table under RLS (four policies, role-matrix rows). The email must carry the app token: either `{{ .Data }}`, which a re-send does not update, or the app sends its own mail through Resend (a new secret and sending path). **Acceptance is unauthenticated but needs the secret key** to mint a session (`generateLink` + `verifyOtp`) | Breaks the function's "live admin check before the secret-key client" invariant, or needs a second SECURITY DEFINER function | Highest cost and the most new attack surface. Not recommended                                            |
| (c) One lifetime, 72 h via the Management API                | 72 h   | 72 h  | Same as (a)                                                                                                                                                                                                                                                                                                                                                            | "Strongly discouraged" by Supabase. Reset links and the 6-digit OTP live 72 h                | Meets the invite figure at reset's expense                                                                |
| (d) Keep 1 h for every link                                  | 1 h    | 1 h   | None                                                                                                                                                                                                                                                                                                                                                                   | The reset guardrail is unchanged                                                             | Most invitees open mail later than an hour, so most invites need a re-send or a self-serve "Forgot password" (C8). Poor for the primary flow |

Under every option the code is the same apart from the copy mirrors. So `/10x-plan` can start as soon as the number is chosen, and the number can change later by hand without a code change beyond the copy.

## Decisions needed (before `/10x-plan`)

1. **D1, link lifetime** (C1). Recommended: (a) 24 h for every link, with OTP length 10, amending the PRD's non-functional guardrail and closing Open Roadmap Question 2.
2. **D2, invitee fence** (C2, C3). Recommended: set `must_change_password` at invite and narrow the clear trigger to `old.email_confirmed_at is not null`.
3. **D3, invitation state** (C4). Recommended: mirror `invited_at` and `email_confirmed_at` into `user_directory`.
4. **D4, re-invite with a different role** (C7). Update the role (recorded as `role_changed`), or refuse the mismatch. Also choose the re-send cooldown (C6): 60 s or 300 s.
5. **D5, revoke record identity** (C9). Recommended: accept the target-less record now, and decide jointly with S-411 whether removal kinds get an email snapshot.
6. **D6, the expired-invite copy** (C8, C10). "Ask your admin to re-send" only, as US-401 has it, or also mention "Forgot password".

## Suggested phasing (input for `/10x-plan`)

1. **Hosted first, by hand.** Set the decided `mailer_otp_exp` and `mailer_otp_length`. Sync the invite subject and template. Read one real invite email. Nothing in the app can send an invite yet, so this is safe before any merge.
2. **Migration.** Three enum values; the narrowed clear trigger; the `invited_at` / `email_confirmed_at` mirror; `pnpm db:types`. Pin the fence through acceptance in an integration test (`generateLink({ type: "invite" })` → `verifyOtp` → flag still set → choose a password → flag clear). Reuse the `pendingAdmin` principal: an invitee is the same principal to RLS, so no new role-matrix column.
3. **Function.** `invite` (directory check → `generateLink` → flag, record, grant → `inviteUserByEmail`), `resend` (cooldown), `revoke` (unconfirmed only). Deno tests for parsing; HTTP-surface cases in `src/test/admin-users.integration.test.ts`, reading Mailpit. Restart the edge runtime after edits (CLAUDE.md).
4. **Link flow.** `invite` in `EMAIL_LINK_TYPES`; landing `/account?notice=invite`; type-aware failure state; invite copy on the confirm and account pages; the signed-in-session warning.
5. **Users page.** Invite becomes the primary control (`UsersPage.tsx:46` already calls it that). Add the Invited and Link-expired statuses, Re-send and Revoke row actions, per-op results in `invoke-admin-users.ts`, and the new kinds in `LastChange`.
6. **E2E and docs.** An invite spec (admin invites → Mailpit → simulated scanner GET → Continue in a fresh context → password → lands read-only → admin sees Viewer). Runbook updates. Then the hosted done-line demo against the coordinator's mailbox, which also closes S-402's deferred M365 / Safe Links check.

Size: smaller than S-409. It adds no runtime, no toolchain boundary and no CI change. The bulk is the Users-page UI and tests.

## Code References

- [`supabase/functions/admin-users/handler.ts:43-45`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/functions/admin-users/handler.ts#L43-L45): op routing, the two-way ternary that becomes a switch.
- [`supabase/functions/admin-users/handler.ts:57`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/functions/admin-users/handler.ts#L57): `create`'s `createUser(… email_confirm: true)`, which is why S-409 accounts are confirmed.
- [`supabase/migrations/20261109143000_must_change_password.sql:69-85`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L69-L85): `current_app_role()`, null while flagged.
- [`supabase/migrations/20261109143000_must_change_password.sql:120-124`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L120-L124): the clear trigger whose `WHEN` C2 narrows.
- [`supabase/migrations/20261109143000_must_change_password.sql:128-179`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261109143000_must_change_password.sql#L128-L179): `guard_last_admin()`, counting unflagged admins.
- [`supabase/migrations/20261105073614_user_directory.sql:57-62,121-133`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105073614_user_directory.sql#L121-L133): directory columns and mirror triggers.
- [`supabase/migrations/20261105080343_role_management.sql:48-62,190,251-255`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/migrations/20261105080343_role_management.sql#L48-L62): the no-email record rule, the kind enum, the cascade skip.
- [`src/_pages/password-recovery/model/email-link.ts:7,36-38`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/email-link.ts#L7): `EMAIL_LINK_TYPES` and `LANDING_PATHS`.
- [`src/pages/api/auth/confirm.ts:17-37`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/pages/api/auth/confirm.ts#L17-L37): the only place a link is spent; failure routing.
- [`supabase/templates/recovery.html:15-16`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/templates/recovery.html#L15-L16): the link shape and lifetime copy the invite template copies.
- [`src/_pages/password-recovery/model/recovery-policy.ts:12`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/password-recovery/model/recovery-policy.ts#L12): `LINK_LIFETIME`, mirrored to `mailer_otp_exp`.
- [`supabase/config.toml:198,224-228,246,406-410`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/supabase/config.toml#L224-L228): verification limit, `max_frequency`, `otp_length`, `otp_expiry`, the recovery template block, the function block.
- [`docs/runbooks/hosted-auth-settings.md:43-50`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/docs/runbooks/hosted-auth-settings.md#L43-L50): hosted values set by hand (`mailer_otp_exp`, `smtp_max_frequency`, the dormant `rate_limit_email_sent`, `mailer_autoconfirm`).
- [`src/shared/config/role-gate.ts:10,37`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/shared/config/role-gate.ts#L37): `/account` is role-exempt and the pending user's landing.
- [`src/_pages/users/model/user-rows.ts:69`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/users/model/user-rows.ts#L69): `canReissuePassword` follows the status; gains the Invited status.
- [`src/_pages/users/api/loader.ts:26-27`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/_pages/users/api/loader.ts#L26-L27): drops records whose target was deleted.
- [`src/test/role-matrix-expectations.ts:61`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/src/test/role-matrix-expectations.ts#L61): `pendingAdmin` principal, which an invitee matches.
- `src/test/mailpit.ts`, `src/test/email-links.ts`, `e2e/specs/forgot-password-unauth.spec.ts`, `e2e/specs/create-account.admin.spec.ts`: reusable mail, link and fresh-context helpers.
- [`supabase/auth@v2.196.0 internal/api/verify.go:313-348`](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L313-L348): `signupVerify`, random password before `Confirm`.
- [`supabase/auth@v2.196.0 internal/crypto/crypto.go:45-47`](https://github.com/supabase/auth/blob/v2.196.0/internal/crypto/crypto.go#L45-L47): `token_hash = sha224(email + otp)`.

## Architecture Insights

- **Every lifecycle operation goes through one secret-holding function**, behind a live admin check. That is why invite costs three ops and no new component. Option (b) is expensive because it is the only design that needs an unauthenticated route to the secret key.
- **The flag is the one "pending" lever.** RLS (`current_app_role()`), the last-admin guard and the middleware all read it. Keeping invitees on the same lever, with the trigger narrowed, adds a state to the UI without adding one to the access model: the role matrix needs no new principal.
- **GoTrue is the source of truth for account state, and the mirror is its read model.** Mirroring `invited_at` and `email_confirmed_at` follows S-406's pattern rather than inventing app-side state that can drift.
- **One link page, many link types.** S-402's `EMAIL_LINK_TYPES` was built for this. The parts that turned out recovery-specific (failure routing, copy) are what S-410 generalizes, and S-411's `email_change` then gets them for free.
- **Throttling has to be ours.** GoTrue's per-user interval does not cover invites, and its global cap is off under autoconfirm. Any admin-triggered email needs an app-side cooldown. S-310 (job-completion email) will meet the same constraint.

## Historical Context (from prior changes)

- [`context/foundation/prd.md:409-425`](https://github.com/dobrek/ib-timetable-planner/blob/da96a97b8699fa64bd4e14b48d1188ff5e18425d/context/foundation/prd.md#L409-L425): Open Question 2, options (a)/(b)/(c). S-402 shipped at 3600 s and moved the choice to S-410.
- `context/foundation/health-check.md:344-364`: Fix 5, "decide before `/10x-plan`", calls (a) the smallest change that keeps the PRD's intent.
- `context/changes/user-managment-research/research.md:312-314,509`: the invite template shape (`type=invite`); a probe showed `inviteUserByEmail` works with signups disabled.
- `context/archive/2026-10-19-forgot-password-by-email/change.md:16-23`: production sent the default `ConfirmationURL` template. The rule is to sync and read a real email before merging code that relies on a new hosted template ("S-410 `invite`").
- `context/archive/2026-10-19-forgot-password-by-email/smoke.md:76-94`: the M365 / Safe Links verdict is still deferred.
- `context/archive/2026-10-19-forgot-password-by-email/research.md:248-251`: S-410's accept page as a reason to give the password step its own page. Not needed if `/account` carries an invite banner.
- `context/archive/2026-11-08-create-account-fallback/research.md:297,306`: S-410 and S-411 add ops to the same function; the role is chosen at creation "matching S-410".
- `context/archive/2026-11-08-create-account-fallback/plan.md:331`: create stays secondary "so S-410's invite can become the primary path without rework".
- `context/archive/2026-11-08-create-account-fallback/hosted-check.md:12-18`: hosted DB encryption is off, the fence held on hosted, and hosted GoTrue is v2.197.0.
- `context/archive/2026-11-03-users-page-roles/research.md:149-160`: an "Invited / pending" status was deferred to S-410. `invited` was a proposed future kind.
- `docs/runbooks/email-delivery.md:8,70-75,132`: S-410 reuses the sender, shares the 100/day cap, and the Safe Links check is written for `type=recovery`.

## Related Research

- `context/changes/user-managment-research/research.md`: the milestone's umbrella research.
- `context/archive/2026-10-19-forgot-password-by-email/research.md`: the scanner-safe link flow, `otp_expired`, Safe Links.
- `context/archive/2026-11-08-create-account-fallback/research.md`: the secret-holding function, the fence and the spike method (S-409).
- `context/archive/2026-11-03-users-page-roles/research.md`: the directory, `access_changes`, the last-admin guard.
- `context/archive/2026-10-16-account-self-service/research.md`: the password form and the dropped current-password rule.

## Not verified

- **No live probe was run.** Everything about GoTrue is from source at v2.196.0, compared with v2.197.0 and `master`, and Supabase docs via Context7. The local stack (GoTrue v2.196.0) was running and could confirm C2, C5, C6 and C8 in one short session with throwaway users, as S-409's spike did.
- **Hosted:** the current invite template and subject, any experimental flags, and the dashboard's 86,400 s cap (docs only).
- **How GoTrue keys its verification rate limit** for requests that arrive from the Worker (C14).
- **The race between two concurrent invites** (inferred from code).
- **Whether the `password_changed` notification template can tell a first password from a change** (C15).
