# Invite a colleague by email (S-410) Implementation Plan

## Overview

An admin invites a colleague by email with a role chosen up front. The colleague opens the emailed link, presses Continue on the scanner-safe confirm page, chooses a password, and lands in the app with that role: read-only for a viewer. The admin sees the invitation on the Users page and can re-send or revoke it while it is pending. An expired or used link says "ask your admin to re-send". An address that already has an account is refused, with no duplicate. This is roadmap slice S-410, the milestone's north star (PRD FR-401, FR-402, FR-404's revoke, FR-418, US-401).

It is mostly reuse of S-402 (link flow, sender), S-405 (read-only landing) and S-409 (the `admin-users` function and the `must_change_password` fence). It adds three function operations, one link type, one email template, three Users-page statuses, and one additive migration. There is no new public route, no new function, no new secret and no CI change.

## Current State Analysis

The research (`context/changes/invite-by-email/research.md`) is the codebase baseline. In short:

- **`admin-users`** (`supabase/functions/admin-users/handler.ts`) has two operations, `create` and `reissue`, routed by a two-way ternary (`:43-45`). The order of steps is the design: JWT verified, live `own_app_role = 'admin'`, then the body is read, then the secret-key client acts, then the result is revealed last. `firstFailure` runs named steps; `discard` deletes a half-made account. The parser (`request.ts`) accepts exact keys only.
- **The fence.** `private.current_app_role()` reads null while `user_directory.must_change_password` is set. `guard_last_admin()` ignores pending admins. The clear trigger fires on any `encrypted_password` change (`supabase/migrations/20261109143000_must_change_password.sql:120-124`).
- **The fence fails open on acceptance (research C2).** GoTrue's `signupVerify` writes a random password before it confirms the invitee, which fires the clear trigger. An invitee would hold their role before choosing a password.
- **`user_directory`** mirrors `email`, `is_machine` and `is_service_account` from `auth.users` (`20261105073614_user_directory.sql:95-133`). `private.mirror_auth_user()` has never been re-created since, so the original body is its live body. Nothing in the directory tells an invitation from a temporary password.
- **The link flow** (`src/_pages/password-recovery/`) accepts `recovery` only (`model/email-link.ts:7`). Every failure redirects to `/auth/forgot` with reset copy (`src/pages/api/auth/confirm.ts:36`). The confirm page's heading, lead and incomplete-link copy are reset copy (`ui/ConfirmEmailLinkPage.astro:27-54`).
- **`/account`** shows "An administrator gave you a temporary password" to every pending user (`src/_pages/account/ui/AccountPage.astro:32-38`). A password save always reloads `/account?saved=password` (`ui/PasswordForm.tsx:100`).
- **The Users page** has `active | no_access | temporary_password` statuses (`src/_pages/users/model/user-rows.ts:33`), a "Create account" button marked as the secondary path waiting for S-410 (`ui/UsersPage.tsx:46`), and a courier typed to the password result (`api/invoke-admin-users.ts:19`) with two-way error tables (`api/account-error.ts`).
- **Hosted Auth** runs one lifetime for every email link, `mailer_otp_exp = 3600`, with a 6-digit OTP (`docs/runbooks/hosted-auth-settings.md`). Local: `otp_expiry = 3600`, `otp_length = 6` (`supabase/config.toml`).

## Desired End State

- An admin opens `/users`, presses **Invite**, enters an email and a role (Viewer by default; no "No access"), and sends. The row appears as **Invited** with **Re-send** and **Revoke**.
- The invitee receives "You're invited to IB Planner", with one link to `/auth/confirm?token_hash=…&type=invite`. A scanner's GET or HEAD spends nothing. Pressing Continue signs them in, fenced. `/account` welcomes them and asks for a password. Saving it sends them to `/dashboard` with their role live. A viewer sees everything and edits nothing.
- The row then reads **Active** with the chosen role. Status is **Invitation accepted** if they confirmed but haven't chosen a password yet, and **Invitation expired** once 24 hours pass unaccepted.
- Re-inviting a pending address from the dialog re-sends it and applies a changed role. A re-send within 60 seconds is refused. Revoke deletes the never-used account, and its link then shows the invite-expired copy.
- Inviting an address that has an account (confirmed, temporary password or machine) answers "An account with this email already exists." Nothing is sent and nothing is created.
- Every email link (invite and reset) lives 24 hours with a 10-digit OTP. The PRD guardrail reads "24 h for every email link", and Open Roadmap Question 2 is closed.
- A signed-in person opening any email link sees "You're signed in as … Continuing signs you in as the person this link was sent to."

Verify with the integration suites (fence through acceptance; every `admin-users` op against Mailpit), the new e2e spec, `/verify`, and the hosted check in Phase 6.

### Key Discoveries:

- `signupVerify` writes the random password while `email_confirmed_at` is still null, in the same transaction. A trigger conditioned on `old.email_confirmed_at is not null` skips it even if GoTrue ever folds both into one statement, because `old` is the pre-update row (research C2, `verify.go:313-348`).
- `generateLink({ type: "invite" })` creates the unconfirmed user and sends nothing. `inviteUserByEmail` on an unconfirmed user re-sends with a new token, and the old link dies. That gives "send last" its two halves (research C5; confirmed by current Supabase docs: "no dedicated resend exists (send a new invite)").
- GoTrue's per-user resend interval does not cover invites, and its global cap is dormant under `mailer_autoconfirm`, so the app enforces the cooldown itself (research C6).
- Expired, used, replaced and revoked links all return `otp_expired`, so one invite failure message covers them all (research C10).
- `Astro.locals.user` is populated on public routes too (`src/middleware.ts:50-56`), so the GET confirm page can warn about an existing session with no side effect.
- The role write path is an upsert under the admin's session (`src/_pages/users/api/change-user-role.ts:20-24`). S-406's trigger records it as `role_granted` or `role_changed`.
- `LINK_LIFETIME` copy is mirrored in `recovery-policy.ts:12`, `ForgotPasswordPage.astro:26,92` and `recovery.html:16`. The Users page needs the same lifetime as a number, so it moves to `src/shared/config/`.
- An accepted-but-unfinished invitee is exactly the role matrix's `pendingAdmin` principal (`src/test/role-matrix-expectations.ts:61,127`). No new table means no new capability policies.

## What We're NOT Doing

- **App-issued invite tokens or separate lifetimes per link type** (Open Roadmap Question 2, option b). One 24 h lifetime serves every link.
- **An email snapshot on `invitation_revoked`.** The record keeps who revoked and when; its target becomes null on delete (S-406's ids-only rule). S-411 decides email snapshots for removal kinds once, for both slices.
- **Re-send for an accepted-but-unfinished invitee.** GoTrue refuses an invite to a confirmed user. They finish through "Forgot password", or the admin revokes and re-invites.
- **An account-level invitation expiry.** The 24 h is the link's. After it, an unconfirmed invitee can still claim the account through "Forgot password" (research C8), landing fenced until they choose a password. Revoke is the account-level stop.
- **Changing `current_app_role()` or `guard_last_admin()`.** This keeps S-410 clear of S-408 (research C17).
- **Invites with "No access".** Create keeps that option; invite requires a role.
- **Softening the "password changed" notification for a first password** (research C15). It reads slightly off for an invitee; accepted.
- **Renaming the `password-recovery` slice**, though it now also serves invite acceptance. That is a separate refactor, best done when S-411 adds `email_change`.
- **Widening the public-route allowlist.** `/auth/confirm` and `/api/auth/` already cover acceptance, and `/account` is already role-exempt.
- **Banning or deleting confirmed accounts** (S-411), bulk invites, and CI changes.

## Implementation Approach

Build bottom-up so each layer is proven before the next consumes it. First, the platform facts are probed live and the fence is fixed in SQL, with local Auth config and the template in place so emails carry the right link. Then the function gains its operations, tested at the HTTP surface against Mailpit. Then the link flow learns the invite type, then the Users page drives it, then e2e proves the whole journey. Hosted settings change by hand: the template sync and a real email before merge (S-402's recorded rule), then the hosted check and the done-line demo after merge.

The invitee rides the existing `must_change_password` fence instead of a new access state. RLS, the last-admin guard, the middleware and the role matrix already understand "pending", so the slice adds UI states without adding access states.

## Critical Implementation Details

- **Send last, and only after the fence holds.** For a new address the order is: `generateLink` → flag → record → grant → `inviteUserByEmail`. Any failure before the send, including the send itself, `discard`s the account, so no live link ever exists for an unfenced or half-made account. The `hashed_token` that `generateLink` returns is never logged, returned or used: the email carries `inviteUserByEmail`'s token.
- **Every live invitation link belongs to a fenced account.** The re-send path sets the flag again (idempotent) before it sends, so an invitation made earlier from the dashboard, with no flag, cannot be accepted unfenced.
- **The invite's grant is the role picker's upsert**, under the admin's session, not `create`'s insert. Two admins inviting the same new address at the same moment then both succeed (two emails, the newer link wins). With an insert, the second request would hit the primary key and `discard` the account the first request is about to email.
- **CI's deploy order already fits:** migrations, then the function, then the Worker. The function reads the new directory columns, so it must never deploy without the migration. A failed migration stops the job before the function deploys.
- **Hosted Auth changes before merge** (Phase 6). Between that change and the merge, reset links live 24 h while the deployed reset copy still says "1 hour". That is the safe direction; keep the window short.
- **Edge runtime:** after every function edit, `docker restart supabase_edge_runtime_ib-timetable-planner`, and prove a deliberate break reached the runtime by its log line (CLAUDE.md).

## Phase 1: Platform: probe, migration, local Auth config

### Overview

Confirm on the local stack the GoTrue behaviours the research read only in source. Fix the fence so acceptance keeps it. Mirror invitation state into the directory. Move every email link to 24 h with a 10-digit OTP, with the invite template in place.

### Changes Required:

#### 1. Shared link lifetime

**File**: `src/shared/config/email-link-lifetime.ts` (new), `src/shared/config/index.ts`, `src/_pages/password-recovery/model/recovery-policy.ts`

**Intent**: One source for the email-link lifetime, readable by the reset copy and the Users page (an FSD sibling slice cannot import `password-recovery`). Move it to 24 h.

**Contract**: Exports `EMAIL_LINK_LIFETIME_MS = 86_400_000` and `EMAIL_LINK_LIFETIME = "24 hours"`. The comment names its mirrors: hosted `mailer_otp_exp`, local `otp_expiry`, `recovery.html`, `invite.html`. `recovery-policy.ts` keeps exporting `LINK_LIFETIME` (now from the shared value) so `ForgotPasswordPage.astro` is untouched; its comment is updated to match.

#### 2. Local Auth config and templates

**File**: `supabase/config.toml`, `supabase/templates/invite.html` (new), `supabase/templates/recovery.html`

**Intent**: Local and CI behave like hosted after Phase 6: 24 h links, a 10-digit OTP, and an invite email whose only link opens the scanner-safe confirm page.

**Contract**:
- `[auth.email]`: `otp_expiry = 86400`, `otp_length = 10`, with comments naming the hosted fields and the shared constant.
- New `[auth.email.template.invite]` block: `subject = "You're invited to IB Planner"`, `content_path = "./supabase/templates/invite.html"`.
- `invite.html` follows `recovery.html`'s rules: notes in `{{/* … */}}` only, exactly one link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`, never `{{ .ConfirmationURL }}`, never `{{ .Data }}` (stale on re-send, and user-editable), no student data. The copy says the link works once, for 24 hours, and that only the newest email works.
- `recovery.html`'s "1 hour" becomes "24 hours" and its note points at the shared constant.
- The change applies locally only after `pnpm exec supabase stop && pnpm exec supabase start`.

#### 3. Live probe

**File**: `context/changes/invite-by-email/probe.md` (new); a throwaway script under the scratchpad, never committed

**Intent**: Confirm, before writing SQL, the five behaviours the design rests on, with throwaway users on the local stack (S-409's spike method). If any result contradicts the research, stop and re-plan the affected step.

**Contract**: Record each result with the GoTrue version (`/auth/v1/health`):
- P1: `generateLink({ type: "invite" })` creates an unconfirmed user with `invited_at` set and puts nothing in Mailpit.
- P2: `inviteUserByEmail` on that user sends one email (link shape `type=invite`). The `generateLink` token then fails `verifyOtp` with `otp_expired`. A second immediate `inviteUserByEmail` is not throttled.
- P3: on today's schema, `verifyOtp({ type: "invite" })` on a flagged invitee clears the flag. This reproduces C2.
- P4: `resetPasswordForEmail` for an unconfirmed invitee sends a recovery email, and spending it confirms the user without writing `encrypted_password`.
- P5: the exact error code `inviteUserByEmail` and `generateLink` return for a confirmed user's address (expected `email_exists` or `user_already_exists`).

#### 4. Migration

**File**: `supabase/migrations/<timestamp>_invitations.sql` (via `pnpm exec supabase migration new invitations`)

**Intent**: Additive only. Add the three record kinds, mirror invitation state into the directory, and keep the fence through acceptance. The header explains each choice in the style of `20261109143000_must_change_password.sql`.

**Contract**:
- `set local lock_timeout = '5s'` (triggers on `auth.users`).
- `alter type public.access_change_kind add value if not exists` `invitation_sent`, `invitation_resent`, `invitation_revoked`.
- `user_directory` gains `invited_at timestamptz` and `email_confirmed_at timestamptz`, both nullable, with comments. `authenticated` keeps SELECT only: the table-level revokes already cover new columns, and a post-condition asserts it.
- `private.mirror_auth_user()` re-created from its live body (the original in `20261105073614_user_directory.sql`, never re-created since), adding the two columns to the insert and the `on conflict do update`. It must still never raise.
- `create or replace trigger user_directory_mirror_update`: `after update of email, raw_app_meta_data, invited_at, email_confirmed_at`, with the `WHEN` extended by `old.invited_at is distinct from new.invited_at or old.email_confirmed_at is distinct from new.email_confirmed_at`.
- `create or replace trigger user_directory_clear_must_change_password` with `when (old.encrypted_password is distinct from new.encrypted_password and old.email_confirmed_at is not null)`. The function body is unchanged.
- Backfill the two columns for existing rows from `auth.users`, after the triggers.
- Post-conditions (`do $$ … $$`), each raising on failure:
  - SECURITY DEFINER functions in `public` and `private` are still exactly `private.current_app_role`;
  - the clear trigger's `pg_get_triggerdef` contains the `email_confirmed_at` condition;
  - `mirror_auth_user` is not DEFINER and API roles cannot execute it;
  - `authenticated` can select but not insert or update the new columns, and `anon` cannot select them;
  - no directory row disagrees with `auth.users` on either column after the backfill.

#### 5. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate with `pnpm db:types` (stack up). Check the diff: the two directory columns and the three enum values.

#### 6. Fence-through-acceptance suite

**File**: `src/test/invitation-acceptance.integration.test.ts` (new)

**Intent**: Pin the narrowed trigger and the mirror at the database and Auth level, with a publishable-key client for the invitee and service-role setup (it proves behaviour; the role matrix needs no change, because an accepted invitee is the `pendingAdmin` principal).

**Contract**: Cases:
- `generateLink(invite)` → the directory row shows `invited_at` and a null `email_confirmed_at`.
- A flagged invitee with a role spends the link with `verifyOtp({ type: "invite", token_hash })`. Then `own_app_role` is null, the flag is still set and `email_confirmed_at` is mirrored. Choosing a password with `updateUser` clears the flag and `own_app_role` answers the role.
- An unconfirmed flagged invitee spends a recovery link (P4). The flag stays set until they choose a password.
- An accepted-but-unfinished invited admin does not count for the last-admin guard: demoting the only other admin is refused (PT409).

### Success Criteria:

#### Automated Verification:

- [ ] Migration applies cleanly from scratch: `pnpm exec supabase db reset`
- [ ] Generated types are current and the diff is only the new columns and kinds: `pnpm db:types`
- [ ] Fence-through-acceptance suite passes: `pnpm test:integration src/test/invitation-acceptance.integration.test.ts`
- [ ] S-409's suites stay green (create, reissue, fence): `pnpm test:integration src/test/admin-users.integration.test.ts src/test/role-matrix.integration.test.ts`
- [ ] Type check passes: `pnpm check`
- [ ] Unit suite passes: `pnpm test`

#### Manual Verification:

- [ ] `probe.md` records P1–P5 and none contradicts the research
- [ ] A reset email from the local stack (Mailpit) says "24 hours" and its link still works end to end

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `admin-users`: invite, re-send, revoke

### Overview

The function gains three operations behind the unchanged admin gate. Invite sends last, re-send is throttled, revoke removes only a pending invitation, and reissue refuses invitees.

### Changes Required:

#### 1. Request parsing

**File**: `supabase/functions/admin-users/request.ts`, `request.test.ts`

**Intent**: Accept the three new shapes, exact keys only, as `create` and `reissue` already are.

**Contract**: `AdminRequest` gains `{ op: "invite"; email: string; role: Role }` (role required, never null, email normalised as for `create`), `{ op: "resend"; userId: string }` and `{ op: "revoke"; userId: string }`. Deno tests cover each shape, a null or missing role on invite, extra keys (`data`, `app_metadata`, `redirectTo`), and bad UUIDs.

#### 2. Handler

**File**: `supabase/functions/admin-users/handler.ts`, `index.ts` (if its comment lists operations)

**Intent**: Route by a `switch` on `op`. Add the three operations with the same step discipline as `create`. Extend the header comment's "THE ORDER IS THE DESIGN" with "the email is sent last".

**Contract**: Status table (the Worker reads status codes only):

| Op | Case | Response |
| --- | --- | --- |
| `invite` | No directory row for the email | `generateLink` → `firstFailure[flag, record invitation_sent (new_role), grant (upsert, session)]` → `inviteUserByEmail`. Any failure → `discard` → 500. Success 200 `{ userId, resent: false }` |
| `invite` | Pending: `invited_at` set, `email_confirmed_at` null, not machine | Cooldown check, then the re-send path below with the given role. 200 `{ userId, resent: true }` |
| `invite` | Any other existing row (confirmed, temporary password, machine) | 409 `email_exists`, nothing sent |
| `invite` | `generateLink` says the address exists (a race) | 409 `email_exists`; validation errors → 422 |
| `resend` | Pending, as above | Cooldown, then `firstFailure[flag, role upsert only if the role differs (invite only), record invitation_resent]` → `inviteUserByEmail(directory email)`. 200 `{ userId }`; a failure → 500, no discard |
| `resend` | Not found / not pending | 404 / 409 `not_pending` |
| any re-send | `invited_at` within the last 60 s | 429 `too_soon`, nothing written or sent |
| `revoke` | `invited_at` set and (unconfirmed or flagged), not machine | Record `invitation_revoked` (target = user, `new_role` null) → `deleteUser`. 200 `{ userId }`; a failed delete → 500 |
| `revoke` | Not found / anything else (confirmed and unflagged, S-409 temporary password, machine) | 404 / 409 `not_pending` |
| `reissue` | Target has `invited_at` set | 409 `not_pending` (the answer for an invitee is re-send or revoke) |

- The cooldown constant is `RESEND_COOLDOWN_SECONDS = 60`, read against the directory's `invited_at`.
- The directory lookup is under the secret key: by email for `invite`, by id for the rest. It reads `user_id, email, is_machine, must_change_password, invited_at, email_confirmed_at`.
- `reply` widens to allow a boolean field.
- Every failure logs `{ fn, op, step }` only, never an email or token.
- Revoke's check and its delete are not atomic. If an invitee chooses a password in that instant, their now-active account is deleted. This is accepted and noted in the header.

#### 3. HTTP-surface suite

**File**: `src/test/admin-users.integration.test.ts`

**Intent**: Prove each operation as the Worker calls it, reading mail through `src/test/mailpit.ts` and links through `src/test/email-links.ts`. Backdate `invited_at` with `pg` (`update auth.users …`, which the mirror follows) to step past the cooldown.

**Contract**: The "refuses … whatever it asks" loop includes the three new ops. New `describe` blocks:
- **invite:**
  - Makes the user, flags them, records `invitation_sent` with the actor, grants the role (`role_granted` by the admin), and sends exactly one email whose link is `type=invite`. The body holds no token or password.
  - Re-inviting a pending address inside 60 s is 429 and sends nothing. After backdating, it re-sends: a new email, the old link `otp_expired`, `invitation_resent` recorded.
  - Re-inviting with another role applies it, recorded as `role_changed`.
  - 409 with no email for a confirmed account, an S-409 temporary-password account, and a machine user.
  - A forced flag-write failure (`failFlagWritesFor`) answers 500, leaves no user, and puts nothing in Mailpit.
- **resend:** works on a pending invitee. 409 on an accepted, active or machine user. 404 on an unknown id. 429 inside the cooldown.
- **revoke:**
  - An unconfirmed invitee is deleted. The `invitation_revoked` record survives with its actor and a null target, and the emailed link answers `otp_expired`.
  - An accepted-but-unfinished invitee is deleted.
  - 409 on an active account, an S-409 temporary-password account, and a machine user.
- **reissue:** refuses an invitee (409).

### Success Criteria:

#### Automated Verification:

- [ ] Function gate passes (`deno check`, `deno lint`, `deno test`): `mise run functions:check`
- [ ] HTTP-surface suite passes after an edge-runtime restart: `docker restart supabase_edge_runtime_ib-timetable-planner && pnpm test:integration src/test/admin-users.integration.test.ts`
- [ ] Full integration lane passes: `pnpm test:integration`

#### Manual Verification:

- [ ] A deliberate break in the invite handler (e.g. skipping the flag step) is visible in `docker logs` and turns the suite red, then green again once reverted
- [ ] The runtime log lines for one failed invite name only `fn`, `op` and `step`, with no email or token

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Link acceptance: confirm page, failure copy, account landing

### Overview

`/auth/confirm` learns the invite type, with its own copy, its own failure state and a warning when a session already exists. `/account` welcomes an invitee, and the first password lands in the app.

### Changes Required:

#### 1. Link types and landing

**File**: `src/_pages/password-recovery/model/email-link.ts`, `email-link.test.ts`

**Intent**: Add `invite`, and correct the comment that says "nothing else needs to change": page copy and failure routing are type-aware too (lessons: a convention that cites a mechanism is coupled to it).

**Contract**: `EMAIL_LINK_TYPES = ["recovery", "invite"]`. `LANDING_PATHS.invite = "/account"` (the welcome is driven by the account's pending state, not a query string). The test's "`invite` is refused" assertion flips to accepted; another type (e.g. `signup`) is still refused.

#### 2. Confirm page state and copy

**File**: `src/_pages/password-recovery/model/confirm-page-state.ts` (new) + test, `src/_pages/password-recovery/index.ts`

**Intent**: One vocabulary for what `/auth/confirm` renders and where a failed spend goes, as `forgot-page-state.ts` does for `/auth/forgot`.

**Contract**:
- `confirmFailurePath(type, reason)`: `recovery` → today's `forgotPath("link-expired" | "link-retry")`, unchanged; `invite` → `/auth/confirm?error=invite-expired` or `/auth/confirm?error=invite-retry`.
- `confirmPageState(searchParams)` → `{ kind: "link", link }`, `{ kind: "invite-failed", reason: "expired" | "retry" }` or `{ kind: "incomplete" }`. Unknown values read as `incomplete`.
- A `Record<EmailLinkType, { title; heading; lead }>` copy map: recovery keeps today's wording; invite reads "Accept your invitation" / "Press Continue to sign in and choose your password. The link works once."

#### 3. Spend endpoint

**File**: `src/pages/api/auth/confirm.ts`

**Intent**: Route a failed invite to the invite failure state. Recovery behaviour is unchanged, and so is the malformed branch (no type known).

**Contract**: The failure redirect becomes `confirmFailurePath(link.type, result.reason)`. The log line keeps `outcome` and `type` only.

#### 4. Confirm page

**File**: `src/pages/auth/confirm.astro`, `src/_pages/password-recovery/ui/ConfirmEmailLinkPage.astro`

**Intent**: Render the state with per-type copy, keeping every hard rule: no island, no script, no token in any `href`, and the existing headers.

**Contract**: Props become `{ state; signedInAs: string | null }`, where `signedInAs` is `Astro.locals.user?.email`.
- **`link`:** the type's heading and lead. When `signedInAs` is set, a warning banner reads "You're signed in as {email}. Continuing signs you in as the person this link was sent to."
- **`invite-failed` / `expired`:** "This invitation link has expired or was already used. Ask your admin to re-send it." plus "Already set your password? Sign in" linking to `/auth/signin`.
- **`invite-failed` / `retry`:** "We couldn't check your invitation just now. Open the link from your email again."
- **`incomplete`:** neutral copy ("This link is incomplete. Open it straight from the email.") with links to sign-in and to request a reset.

The route's `<Layout title>` comes from the state.

#### 5. Account page: who is pending, and the first password

**File**: `src/pages/account.astro`, `src/_pages/account/api/` (a new own-row read), `src/_pages/account/ui/AccountPage.astro`, `AccountSettings.tsx`, `PasswordForm.tsx`, `src/_pages/account/model/` (a pure saved-path helper + test)

**Intent**: An invitee is welcomed, not told about a temporary password. Every pending account's first password lands in the app.

**Contract**:
- When `Astro.locals.access.status === "password_change_required"`, the route reads the caller's own `user_directory.invited_at` (their own row is readable). It passes `pendingKind: "invitation" | "temporary_password" | null`. A failed read fails the page, as the profile read does.
- Banner: `invitation` → "Welcome to IB Planner. Choose a password below to start using the planner."; `temporary_password` → today's wording, unchanged. When pending, the `notice=recovery` banner is not shown as well (one banner).
- `PasswordForm` takes `isFirstPassword` (true when `pendingKind` is not null) and navigates to `/dashboard` after the save; otherwise `/account?saved=password` as today. A pure `passwordSavedPath(isFirstPassword)` in `model/` carries the rule. If the flag did not clear, the middleware sends the person back to `/account`, which is the safe direction.

### Success Criteria:

#### Automated Verification:

- [ ] Unit suite passes (email-link, confirm-page-state, saved-path): `pnpm test`
- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Existing reset e2e still passes (recovery path unchanged): `pnpm test:e2e e2e/specs/forgot-password-unauth.spec.ts`

#### Manual Verification:

- [ ] With `pnpm build && pnpm preview`, an invite link from Mailpit opens "Accept your invitation", and Continue lands on `/account` with the welcome banner
- [ ] The same link opened again shows the invite-expired copy with the sign-in link
- [ ] Opening a link while signed in shows the warning, and nothing is spent until Continue

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Users page: invite dialog, statuses, row actions

### Overview

Invite becomes the primary control. Rows show the invitation's state and offer Re-send and Revoke. The courier and the error tables learn the new operations.

### Changes Required:

#### 1. Schemas and actions

**File**: `src/_pages/users/model/schemas.ts` (+ test), `src/_pages/users/api/actions.ts`, `src/_pages/users/api/invite-user.ts`, `resend-invitation.ts`, `revoke-invitation.ts` (new), `src/_pages/users/api/index.ts`

**Intent**: Three thin actions, each a courier to `admin-users`, with Zod input shared with the forms (lessons: Astro Actions are the single transport).

**Contract**: `inviteUserInput = { email, role: z.enum(APP_ROLE_VALUES) }` (not nullable) and `invitationTargetInput = { userId: uuid }`. `userActions` gains `inviteUser`, `resendInvitation` and `revokeInvitation`, each `requires: "manage_users"`.

#### 2. Courier and error tables

**File**: `src/_pages/users/api/invoke-admin-users.ts` (+ test), `account-error.ts` (+ test), `constants.ts`

**Intent**: Results typed per operation, and messages chosen per operation and status from fixed wording. A response body never reaches a message.

**Contract**:
- `AdminUsersBody` covers all five ops. The result is narrowed per op: `create`/`reissue` → `TemporaryPassword`; `invite` → `{ userId; resent: boolean }`; `resend`/`revoke` → `{ userId }`. A body missing its fields → `outcomeUnknown(op)`.
- `toAccountError` becomes a table keyed by operation instead of two-way ternaries. New messages:
  - invite 409 → `EMAIL_EXISTS_MESSAGE`;
  - resend/revoke 409 → "That invitation is no longer pending.";
  - 429 → "An invitation was sent less than a minute ago. Wait a minute, then re-send." (code `TOO_MANY_REQUESTS`);
  - invite 500 → "Couldn't send the invitation, and nothing was created. Try again.";
  - resend 500 → "Couldn't re-send the invitation. Try again.";
  - revoke 500 → "Couldn't revoke the invitation. Check the list before trying again.";
  - invite unknown → "The request didn't finish, so the invitation may have been sent. Check the list."

#### 3. Rows and statuses

**File**: `src/_pages/users/api/loader.ts`, `src/_pages/users/model/user-rows.ts` (+ test), `status-labels.ts`

**Intent**: Derive invitation state from the mirrored columns, purely, with `now` passed in.

**Contract**:
- The loader selects `invited_at, email_confirmed_at` and passes `now`. `UserStatus` gains `invited | invitation_expired | invitation_accepted`. Precedence, first match wins:
  1. `invited_at` set and `email_confirmed_at` null → `invitation_expired` when `now > invited_at + EMAIL_LINK_LIFETIME_MS`, else `invited`;
  2. flagged → `invitation_accepted` if `invited_at` is set, else `temporary_password`;
  3. no role → `no_access`;
  4. otherwise → `active`.
- `UserRow` gains `canResendInvitation` (`invited`, `invitation_expired`) and `canRevokeInvitation` (those two plus `invitation_accepted`). `canReissuePassword` stays `temporary_password` only.
- Labels: "Invited", "Invitation expired", "Invitation accepted".
- Tests cover each status, the boundary (exactly `invited_at + 24 h` is still `invited`; one millisecond later is `invitation_expired`, matching GoTrue's `now > sent + exp`), an unconfirmed invitee with no flag (a dashboard-era invite reads `invited`), and an invited account that finished (reads `active`).

#### 4. UI

**File**: `src/_pages/users/ui/InviteDialog.tsx`, `ConfirmRevokeDialog.tsx` (new), `UserTable.tsx` (+ test), `UsersPage.tsx` (+ test), `src/_pages/users/model/submit-invite.ts`, `use-invitation-actions.ts` (new)

**Intent**: The invite flow and row actions follow the existing dialog and hook patterns (react-hook-form + shared Zod + `mode: "onTouched"`, shadcn `Dialog`, semantic tokens only).

**Contract**:
- The header gets a primary **Invite** button. **Create account** stays `outline`, and its comment is updated: it is the fallback now that the invite exists.
- `InviteDialog`: email field plus a role select (Viewer, Author, Admin; default Viewer). The toast says "Invitation sent to {email}" or, when `resent`, "Invitation re-sent to {email}". The page refreshes after success.
- `UserTable`'s status cell shows **Re-send** and **Revoke** link buttons by flag, with `aria-label`s naming the person. Re-send is disabled while in flight.
- Revoke asks first: "Revoke the invitation for {email}? Their link stops working and the account is removed."
- Errors toast the fixed messages.
- The role picker stays live on invitee rows: changing it is the S-406 upsert.

### Success Criteria:

#### Automated Verification:

- [ ] Unit and component tests pass (user-rows, account-error, invoke-admin-users, schemas, UserTable, UsersPage): `pnpm test`
- [ ] Type check passes: `pnpm check`
- [ ] Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] Build passes, with no Supabase key in client output: `pnpm build`
- [ ] Existing Users-page e2e still passes: `pnpm test:e2e e2e/specs/users.admin.spec.ts`

#### Manual Verification:

- [ ] Through `pnpm build && pnpm preview`:
  - inviting a fresh address shows an "Invited" row with Re-send and Revoke;
  - re-sending at once shows the wait-a-minute message;
  - revoking removes the row.
- [ ] Dialogs and statuses read correctly in light and dark themes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: E2E and docs

### Overview

One browser spec walks the north-star flow and the main refusals. The docs, PRD and roadmap record what shipped and what was decided.

### Changes Required:

#### 1. Shared e2e mail helpers

**File**: `e2e/support/mail.ts` (new), `e2e/specs/forgot-password-unauth.spec.ts`

**Intent**: Move the spec-local `confirmLinkIn` (made type-agnostic) and the Mailpit wait into `e2e/support/`, so the reset and invite specs share them.

#### 2. Invite spec

**File**: `e2e/specs/invite.admin.spec.ts` (new), `e2e/specs/create-account.admin.spec.ts`

**Intent**: Prove the PRD's primary flow in a real browser. A fresh browser context plays the invitee (spending a link replaces the session).

**Contract**: Scenarios:
1. Admin invites a fresh address as Viewer.
   - A scanner's `GET` and `HEAD` on the emailed URL (Playwright `request`) spend nothing.
   - A fresh context opens the URL and presses Continue, then sees the welcome banner on `/account`. It chooses a 15+ character password, lands on `/dashboard` and sees no edit control.
   - The admin reloads `/users` and sees the row as Viewer, Active.
2. Re-inviting the same address at once shows the wait-a-minute message.
3. Revoke: the row disappears, and the emailed link's Continue shows "Ask your admin to re-send it".
4. Inviting the admin's own address shows "An account with this email already exists."
5. The admin's own context opening an invite link sees the signed-in warning (Continue is not pressed).

Invited users are torn down through `e2e/support/admin-api.ts`. `create-account.admin.spec.ts` is updated for the first password now landing on `/dashboard`.

#### 3. Documentation

**File**: `CLAUDE.md`, `README.md`, `docs/runbooks/hosted-auth-settings.md`, `docs/runbooks/author-provisioning.md`, `docs/runbooks/email-delivery.md`, `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: Every doc that names the mechanisms this slice changes says what is true after it.

**Contract**:
- **CLAUDE.md:**
  - § Database & auth: the clear trigger fires only for a confirmed user, so acceptance keeps the fence; an invitee is fenced from creation; the directory mirrors `invited_at`/`email_confirmed_at`; `invite` is in `EMAIL_LINK_TYPES`.
  - § Edge Functions: five ops; invite sends last; the 60 s cooldown; revoke covers pending invitations only; S-411 shares the mirror.
- **README:** the `/users` row in Auth routes covers invite, re-send and revoke; the "Until S-410 ships the invitation" sentence becomes the invite-first account flow.
- **hosted-auth-settings.md:**
  - rows: `mailer_otp_exp` `86400` (with the coupling to the shared constant and both templates), `mailer_otp_length` `10`, `mailer_subjects_invite` and `mailer_templates_invite_content`;
  - the check `jq` and the template sync and read-back include the invite fields;
  - `uri_allow_list`'s "S-410 will read it" note is corrected (no `redirectTo` is sent).
- **author-provisioning.md:** invite is the normal path, Create account the fallback.
- **email-delivery.md:** invites share the 100/day cap; the Safe Links check also covers `type=invite`.
- **PRD:** the guardrail line becomes "Every email link (invitation, password reset) stops working 24 hours after it is sent", with a dated decision note under Open Question 2.
- **Roadmap:** Open Roadmap Question 2 is marked decided (2026-11-10, option a, 24 h, OTP 10). S-410's risk line no longer says it widens the allowlist.

### Success Criteria:

#### Automated Verification:

- [ ] Invite spec passes: `pnpm test:e2e e2e/specs/invite.admin.spec.ts`
- [ ] Full e2e suite passes (solver running, per README): `pnpm test:e2e`
- [ ] Full local CI gate passes: `/verify`
- [ ] Integration lane passes: `pnpm test:integration`

#### Manual Verification:

- [ ] Docs read correctly: every changed claim matches the shipped behaviour, and no doc still says "invite 72 h" or "1 hour" for links

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Hosted rollout (by hand)

### Overview

Hosted Auth is changed by hand: before merge, the settings and templates are set and one real email is read; after merge, the full flow is checked on hosted; then comes the milestone's done-line demo against the coordinator's school mailbox.

### Changes Required:

#### 1. Before merge

**File**: none in the repo; the record goes in `context/changes/invite-by-email/hosted-check.md` (new)

**Intent**: S-402's rule: sync a new hosted template and read a real email before merging code that relies on it. Never `supabase config push`.

**Contract**:
- Per `docs/runbooks/hosted-auth-settings.md` (as updated in Phase 5): PATCH `mailer_otp_exp: 86400` and `mailer_otp_length: 10`. Sync the invite subject and template, and the updated recovery template. Run the read-back diff (byte-for-byte).
- Send one throwaway invite with the Admin API from Node tooling (secret key, never the Worker) to a developer mailbox. Check that it arrives in the inbox, that sender authentication passes, that the link is `https://ib-timetable-planner.dev/auth/confirm?token_hash=…&type=invite`, and that the copy says 24 hours. Then delete that user (it never held a role).
- Merge only outside a production solve (README's rule).

#### 2. After merge

**Intent**: Confirm the deployed migration and the flow on hosted, recorded in `hosted-check.md`.

**Contract**:
- SQL check: `pg_get_triggerdef` for `user_directory_clear_must_change_password` includes the `email_confirmed_at` condition, and the directory columns are backfilled.
- One full invite through the hosted Users page to a throwaway mailbox, in a fresh browser:
  - after Continue, SQL shows the flag still set and `email_confirmed_at` set;
  - after the password, the person lands read-only and the row reads Viewer, Active.
- Revoke a second throwaway invitation, and see its link refused with the invite copy. Clean up both users.

#### 3. Done-line demo

**Intent**: The milestone's done-line: the PRD's primary flow on hosted against the coordinator's real school mailbox (M365). It also closes S-402's deferred Safe Links check.

**Contract**: The invite reaches the coordinator's colleague's inbox, not quarantine. Safe Links rewriting or pre-fetching does not spend the link. The colleague lands read-only and is listed as a Viewer. The result is recorded in `hosted-check.md` and in `docs/runbooks/email-delivery.md`'s Safe Links note.

### Success Criteria:

#### Automated Verification:

- [ ] Hosted settings read back as set: the runbook's check `jq` shows `mailer_otp_exp: 86400`, `mailer_otp_length: 10` and `mailer_subjects_invite`, and the template read-back diff is empty
- [ ] CI `deploy` job green on the merge commit: `GH_TOKEN=$(gh auth token --user dobrek) gh run list --branch main --limit 1`

#### Manual Verification:

- [ ] Pre-merge throwaway invite email checked and its user deleted
- [ ] Post-merge hosted flow checked (flag held through acceptance, read-only landing, revoke refuses the link)
- [ ] Done-line demo shown against the coordinator's school mailbox, and recorded

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `request.test.ts` (Deno): every op's exact shape; invite refuses a null role and smuggled `data` or `app_metadata`.
- `email-link.test.ts`: `invite` accepted, other types refused.
- `confirm-page-state.test.ts`: failure paths per type, and an unknown `error` reads as `incomplete`.
- `user-rows.test.ts`: status precedence, the exact 24 h boundary, a dashboard-era unconfirmed invitee, a finished invitee.
- `account-error.test.ts`: every op × status cell. `invoke-admin-users.test.ts`: per-op result narrowing and `outcomeUnknown`.
- `UserTable.test.tsx` / `UsersPage.test.tsx`: Re-send and Revoke appear only by flag; the invite dialog's success toasts.
- Saved-path helper: first password → `/dashboard`.

### Integration Tests:

- `invitation-acceptance.integration.test.ts`: the fence holds through invite acceptance and through recovery of an unconfirmed invitee, and lifts on the chosen password. The mirror follows `invited_at` and `email_confirmed_at`. An accepted-unfinished admin doesn't count for the last-admin guard.
- `admin-users.integration.test.ts`: invite, re-send, cooldown, re-invite role change, revoke, the refusals, send-last rollback with nothing in Mailpit, and reissue refusing invitees.

### Manual Testing Steps:

1. Locally, through `pnpm build && pnpm preview`: invite a fresh address, open its Mailpit link in a private window, Continue, choose a password, land on the dashboard read-only.
2. Re-open the same link: the invite-expired copy with the sign-in link.
3. Revoke a second invitation and open its link: the same copy.
4. Open an invite link in the admin's own window: the signed-in warning, and nothing spent.
5. On hosted: Phase 6's pre-merge email, post-merge flow and done-line demo.

## Performance Considerations

None material. The Users page reads two more columns over tens of rows. `/account` adds one own-row read, only for a pending user. Drag-drop validation is untouched.

## Migration Notes

The migration is additive: two nullable columns, three enum values, a re-created non-raising mirror function, and two `create or replace trigger`s. Existing users get their columns backfilled. No flag changes, and S-409 accounts (created confirmed) behave exactly as before. Roll forward with a new migration if anything is wrong. Hosted Auth values are rolled back by hand through the runbook (`mailer_otp_exp: 3600`, `mailer_otp_length: 6`) together with the copy constant and both templates.

## References

- Research: `context/changes/invite-by-email/research.md`
- PRD: `context/foundation/prd.md` (US-401, Non-functional guardrails, Open Question 2)
- Roadmap: `context/foundation/roadmap.md` (S-410, Open Roadmap Question 2)
- S-409 plan and hosted check: `context/archive/2026-11-08-create-account-fallback/plan.md`, `hosted-check.md`
- S-402 template lesson: `context/archive/2026-10-19-forgot-password-by-email/change.md:16-23`, `smoke.md:76-94`
- Similar implementation: `supabase/functions/admin-users/handler.ts:53-73` (create's step order), `src/_pages/password-recovery/model/forgot-page-state.ts` (page-state vocabulary)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Platform: probe, migration, local Auth config

#### Automated

- [x] 1.1 Migration applies cleanly from scratch: `pnpm exec supabase db reset` — 245ccd96
- [x] 1.2 Generated types are current and the diff is only the new columns and kinds: `pnpm db:types` — 245ccd96
- [x] 1.3 Fence-through-acceptance suite passes: `pnpm test:integration src/test/invitation-acceptance.integration.test.ts` — 245ccd96
- [x] 1.4 S-409's suites stay green (create, reissue, fence): `pnpm test:integration src/test/admin-users.integration.test.ts src/test/role-matrix.integration.test.ts` — 245ccd96
- [x] 1.5 Type check passes: `pnpm check` — 245ccd96
- [x] 1.6 Unit suite passes: `pnpm test` — 245ccd96

#### Manual

- [x] 1.7 `probe.md` records P1–P5 and none contradicts the research — 245ccd96
- [x] 1.8 A reset email from the local stack (Mailpit) says "24 hours" and its link still works end to end — 245ccd96

### Phase 2: `admin-users`: invite, re-send, revoke

#### Automated

- [x] 2.1 Function gate passes (`deno check`, `deno lint`, `deno test`): `mise run functions:check`
- [x] 2.2 HTTP-surface suite passes after an edge-runtime restart: `docker restart supabase_edge_runtime_ib-timetable-planner && pnpm test:integration src/test/admin-users.integration.test.ts`
- [x] 2.3 Full integration lane passes: `pnpm test:integration`

#### Manual

- [x] 2.4 A deliberate break in the invite handler (e.g. skipping the flag step) is visible in `docker logs` and turns the suite red, then green again once reverted
- [x] 2.5 The runtime log lines for one failed invite name only `fn`, `op` and `step`, with no email or token

### Phase 3: Link acceptance: confirm page, failure copy, account landing

#### Automated

- [ ] 3.1 Unit suite passes (email-link, confirm-page-state, saved-path): `pnpm test`
- [ ] 3.2 Type check passes: `pnpm check`
- [ ] 3.3 Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] 3.4 Existing reset e2e still passes (recovery path unchanged): `pnpm test:e2e e2e/specs/forgot-password-unauth.spec.ts`

#### Manual

- [ ] 3.5 With `pnpm build && pnpm preview`, an invite link from Mailpit opens "Accept your invitation", and Continue lands on `/account` with the welcome banner
- [ ] 3.6 The same link opened again shows the invite-expired copy with the sign-in link
- [ ] 3.7 Opening a link while signed in shows the warning, and nothing is spent until Continue

### Phase 4: Users page: invite dialog, statuses, row actions

#### Automated

- [ ] 4.1 Unit and component tests pass (user-rows, account-error, invoke-admin-users, schemas, UserTable, UsersPage): `pnpm test`
- [ ] 4.2 Type check passes: `pnpm check`
- [ ] 4.3 Lint and FSD structure pass: `pnpm lint && pnpm steiger`
- [ ] 4.4 Build passes, with no Supabase key in client output: `pnpm build`
- [ ] 4.5 Existing Users-page e2e still passes: `pnpm test:e2e e2e/specs/users.admin.spec.ts`

#### Manual

- [ ] 4.6 Through `pnpm build && pnpm preview`: inviting a fresh address shows an "Invited" row with Re-send and Revoke; re-sending at once shows the wait-a-minute message; revoking removes the row
- [ ] 4.7 Dialogs and statuses read correctly in light and dark themes

### Phase 5: E2E and docs

#### Automated

- [ ] 5.1 Invite spec passes: `pnpm test:e2e e2e/specs/invite.admin.spec.ts`
- [ ] 5.2 Full e2e suite passes (solver running, per README): `pnpm test:e2e`
- [ ] 5.3 Full local CI gate passes: `/verify`
- [ ] 5.4 Integration lane passes: `pnpm test:integration`

#### Manual

- [ ] 5.5 Docs read correctly: every changed claim matches the shipped behaviour, and no doc still says "invite 72 h" or "1 hour" for links

### Phase 6: Hosted rollout (by hand)

#### Automated

- [ ] 6.1 Hosted settings read back as set: the runbook's check `jq` shows `mailer_otp_exp: 86400`, `mailer_otp_length: 10` and `mailer_subjects_invite`, and the template read-back diff is empty
- [ ] 6.2 CI `deploy` job green on the merge commit: `GH_TOKEN=$(gh auth token --user dobrek) gh run list --branch main --limit 1`

#### Manual

- [ ] 6.3 Pre-merge throwaway invite email checked and its user deleted
- [ ] 6.4 Post-merge hosted flow checked (flag held through acceptance, read-only landing, revoke refuses the link)
- [ ] 6.5 Done-line demo shown against the coordinator's school mailbox, and recorded
