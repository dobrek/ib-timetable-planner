# Remove and Correct Accounts Implementation Plan

## Overview

An admin can ban, unban, or delete an active, deactivated, or temporary-password account, and can set a new email on those accounts or on their own. A ban also pauses the account, so data access ends on the next request. Invitations stay on Revoke. A confirmed-account password reset stays out.

## Current State Analysis

`admin-users` is the only component that holds the secret key. It accepts `create`, `reissue`, `invite`, `resend`, and `revoke` (`supabase/functions/admin-users/request.ts`). Revoke records `invitation_revoked` and then calls `deleteUser`; the history row's target becomes null. It refuses a confirmed account (`handler.ts`, `isRevocable`). The Users page offers Re-issue, Re-send, Revoke, Deactivate, and Reactivate (`src/_pages/users/ui/UserTable.tsx`). There is no ban, unban, delete, or change-email control.

Deactivation is the immediate fence. While `user_roles.deactivated_at` is set, `private.current_app_role()` reads null, so the next request fails closed. `guard_last_admin()` refuses deactivating, demoting, or removing the last admin who is neither pending nor deactivated, and it returns early on the account-deletion cascade so `deleteUser` and test teardown keep working (`supabase/migrations/20261112110654_deactivation_fence.sql`). A GoTrue ban blocks sign-in for its duration. Current Auth source rejects a banned user inside `requireAuthentication`, including a token issued before the ban. The local probe on auth v2.189.0 did not, and the managing-user-data guide still says a ban does not revoke sessions. PostgREST accepts a signed JWT until `exp`. This project's access tokens last one hour (`supabase/config.toml`). Composing the ban with deactivation is what makes the cutoff independent of that split.

`user_directory` has a row for every account, including a temporary-password account with no role. `authenticated` has SELECT only. The mirror upsert names its columns and leaves any other column untouched (`private.mirror_auth_user()` in `supabase/migrations/20261111074135_invitations.sql`). `must_change_password` is the precedent for a column the function writes under the secret key.

Status is a pure first-match in `statusOf` (`src/_pages/users/model/user-rows.ts`): unaccepted invitation, then a pending password, then deactivation, then the role. The loader drops history rows whose target is null. Plans and jobs set their credit columns to null when the account goes (`ON DELETE SET NULL`). The credit label for that null is Unknown (`src/entities/user/model/credit.ts`).

## Desired End State

From the Users page, an admin can:

- Ban an active, deactivated, or temporary-password account. The row says Banned. Sign-in stops, and data access ends on the next request. Unban returns the row to Active when the ban was the only fence, and to Deactivated when a pause was already there.
- Delete those same accounts. The person's plans and jobs remain. The history keeps who deleted them and when, and drops the person's id. The page does not list removed people.
- Set a new email on those accounts and on their own row. The address is typed twice, applied immediately, and refused when the directory already holds it. No confirmation link is sent.

Invitations stay on Revoke. Machine users, the Service account, a row with no role, and ban or delete of the caller's own row are refused. The last admin the guard counts as active cannot be banned or deleted. A confirmed account's password is still that person's own reset, or a dashboard action. Re-issue stays limited to Temporary password.

### Key Discoveries:

- Enforcement that must survive the deletion cascade lives in the function. The guard's early return is deliberate (`20261112110654_deactivation_fence.sql`).
- `user_directory.banned_at` can remember a ban for every account, including one with no role row. The mirror's `ON CONFLICT` update does not mention columns it was not given, so it will not clear `banned_at` as long as `mirror_auth_user()` is left as it is.
- Unban can tell a ban-owned pause from an earlier one only when `deactivated_at` and `banned_at` were written as the same timestamp. History rows cannot: the deactivation trigger and the ban record are two writes, and the trigger's row is always the earlier one.
- The role matrix needs no new principal. A banned admin has `deactivated_at` set, which `deactivatedAdmin` already pins. A temporary-password account with no role is fenced by having no role, plus the GoTrue ban.
- `email_confirm: true` on `updateUserById` sets the address confirmed and does not start a confirmation flow (Admin API reference). `ban_duration: "none"` is the documented way to clear a ban. The permanent value is whatever that reference documents for a ban that does not expire; the integration test pins the spelling.
- The courier maps HTTP status to fixed copy and never renders the function's text (`src/_pages/users/api/account-error.ts`). A last-admin refusal needs its own error code so it can use the existing sentence.

## What We're NOT Doing

- An admin reset of a confirmed account's password. Re-issue stays for Temporary password only.
- A confirmation link, a new mail sender, a template, or an `email_change` entry in `EMAIL_LINK_TYPES`.
- Storing an address on `access_changes`, or listing removed people on the Users page.
- A "Deleted user" credit, or kind columns on `plans` and `generation_jobs`.
- A second Edge Function, a secret key in the Worker, or a change to `private.current_app_role()`, `guard_last_admin()`, or `record_role_change()`.
- Re-creating `private.mirror_auth_user()`.
- Mirroring GoTrue's `banned_until`.
- A new role-matrix principal.
- Ban, delete, or email change for an invitation (Invited, expired, or accepted), a machine user, the Service account, or a row with no role. Deactivate on the Service account stays as it is.
- Ban or delete of the caller's own row. Changing their own email is in scope.
- Hiding Ban or Delete when the target is the last active admin. The server refuses, as Deactivate already does.
- Teaching the page to understand a ban made in the Supabase dashboard. That ban does not set `banned_at`.

## Implementation Approach

Four new operations on `admin-users`: `ban`, `unban`, `delete`, `change_email`. The admin gate and the two clients stay. Role and deactivation writes go through the admin's session, so the guard and `record_role_change()` attribute them. `banned_at`, the directory lookup, the Auth Admin API, and the explicit history rows go through the secret-key client.

`banned_at` lives on `user_directory`, nullable, default null. The function writes it the way it writes `must_change_password`. Authenticated keeps SELECT only.

A ban of an account that has a role row and a null `deactivated_at` sets `deactivated_at` and `banned_at` to one timestamp. A ban of an account that is already paused sets `banned_at` only. A ban of a temporary-password account with no role row sets `banned_at` only. Unban clears `deactivated_at` only when it equals `banned_at`.

The Users page learns the status from `banned_at`. Banned outranks Deactivated and Temporary password. Reactivate reads `user_directory.banned_at` and refuses while it is set, so it cannot lift a ban's pause and leave the GoTrue ban in place. The column is on the directory, not on `user_roles`, because a temporary-password account may have no role row.

## Critical Implementation Details

### Timing and lifecycle

Ban writes the app's own rows before it calls GoTrue, and rolls them back if GoTrue refuses. Order: refuse (machine, service account, self, invitation, no role, already banned), then the deactivation update through the session when the ban owns the pause, then `banned_at`, then `updateUserById({ ban_duration })`, then the `account_banned` row. A `PT409` from the deactivation update is the last-admin refusal: return 409 and do not call GoTrue. That write is what serialises two admins, because `guard_last_admin()` takes advisory lock `406001` inside the update. Delete cannot use that lock across `deleteUser`. The function applies the guard's predicate (admin, `deactivated_at` null, not `must_change_password`, no other such admin) and then deletes. Two admins deleting each other can both pass, the same race revoke already accepts. Do not add a raising trigger on `auth.users`.

A pending sole admin can be deleted under that predicate, because a pending admin does not count. Banning them still sets `deactivated_at` when they have a role row, and the trigger refuses that write when no other active admin exists. Map that `PT409` to the last-admin refusal.

Delete records `account_deleted` and then calls `deleteUser`, the same order as revoke, because the history insert cannot name a user who is already gone. Ban, unban, and email change record after the Auth call succeeds. A failed Auth call must not leave `account_banned` or `email_changed` on an account that did not change. If the history insert fails after a successful ban, the ban stays and the log line is the trace.

The local edge runtime keeps the code it loaded. After editing the function, restart `supabase_edge_runtime_ib-timetable-planner` before trusting an integration run.

### State sequencing

`statusOf` checks `banned_at` first. A banned temporary-password row says Banned, so Re-issue is hidden until Unban. The role picker keeps sending `{ user_id, role }` only (`src/_pages/users/api/change-user-role.ts`). PostgREST updates only the columns it is sent, which is what keeps a ban in place across a role change.

`authenticated` must not gain UPDATE on `banned_at`. Follow the column-privilege post-condition `20261111074135_invitations.sql` uses for `invited_at`. Do not re-create the mirror function to "include" the new column: its current `SET` list leaves an unmentioned column alone, and a re-create that assigned `banned_at` would clear it on every email or metadata update.

## Phase 1: Remember a ban

### Overview

The database can store a ban, the Users status rules can say Banned, and Reactivate cannot clear a ban's pause. Nothing calls GoTrue yet.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_account_ban.sql`

**Intent**: Give the function a place to remember a ban, and give the history the four kinds this slice writes. Existing rows stay unbanned.

**Contract**: Add `user_directory.banned_at timestamptz` null, default null. Comment it as the function's record of a GoTrue ban, written under the secret key, cleared by unban. Add `account_banned`, `account_unbanned`, `account_deleted`, and `email_changed` with `alter type … add value if not exists`. Do not use the new labels in this file. Post-conditions: the four labels exist; `authenticated` has SELECT on `banned_at` and neither INSERT nor UPDATE; no existing row has `banned_at` set. Leave `private.mirror_auth_user()`, `current_app_role()`, `guard_last_admin()`, and `record_role_change()` as they are.

#### 2. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: The app's types learn the column and the four kinds from the local database.

**Contract**: Regenerate with `pnpm db:types` once the migration is applied. Commit the generator output unchanged.

#### 3. Status rules

**File**: `src/_pages/users/model/user-rows.ts`
**File**: `src/_pages/users/model/status-labels.ts`
**File**: `src/_pages/users/api/loader.ts`

**Intent**: A row with `banned_at` set reads Banned, ahead of Deactivated and Temporary password, and offers Unban rather than Reactivate or Re-issue.

**Contract**: `UserStatus` gains `"banned"`. `STATUS_LABELS` maps it to `Banned`. The loader selects `banned_at` with the directory columns it already reads. `statusOf` returns `banned` when `banned_at` is set, before the invitation and pending checks. On a banned row: `canUnban`, `canDelete`, and `canChangeEmail` are true; `canBan`, `canDeactivate`, `canReactivate`, `canReissuePassword`, `canResendInvitation`, and `canRevokeInvitation` are false. The role picker is unchanged. Flags for the other statuses wait for Phase 3 to turn on Ban, Delete, and Change email; Phase 1 only has to make Banned and the reactivate refusal true. A banned row's `canReactivate` is false.

#### 4. Reactivate refusal

**File**: `src/_pages/users/api/set-user-active.ts`

**Intent**: Reactivate must not clear `deactivated_at` while a ban holds, or the person would get data access back and still be unable to sign in.

**Contract**: Before the reactivate update, read `user_directory.banned_at` for that user. When it is set, refuse with the existing "already changed" outcome and do not write. `banned_at` is not a column of `user_roles`, so it cannot be a filter on that update. Deactivate's payload stays `{ deactivated_at }` only.

### Success Criteria:

#### Automated Verification:

- The migration applies on the local stack with `pnpm exec supabase migration up`.
- `pnpm db:types` produces `banned_at` and the four new `access_change_kind` labels, and the committed file matches.
- `pnpm exec vitest run src/_pages/users/model/user-rows.test.ts src/_pages/users/api/set-user-active.test.ts` passes, including Banned ahead of Deactivated and Temporary password, and reactivate refusing when `banned_at` is set.
- `pnpm exec vitest run src/_pages/users/api/set-user-active.integration.test.ts src/_pages/users/api/change-user-role.integration.test.ts` passes: a row with `banned_at` set is not reactivated, and a role change leaves `banned_at` set.
- `pnpm check` passes.

#### Manual Verification:

- None.

**Implementation Note**: After this phase's automated checks pass, continue to Phase 2. The column is not on screen yet.

---

## Phase 2: Four operations on admin-users

### Overview

The function can ban, unban, delete, and change an email, with the refusals the page will rely on. Integration tests are the proof. The page does not offer the buttons yet.

### Changes Required:

#### 1. Request parser

**File**: `supabase/functions/admin-users/request.ts`
**File**: `supabase/functions/admin-users/request.test.ts`

**Intent**: Accept the four operations and refuse any other shape, the way the existing parser does.

**Contract**: `ban`, `unban`, and `delete` carry `userId` only, parsed like `revoke`. `change_email` carries `userId` and `email`, with the email normalised by the existing helper. An unknown key is refused. Success bodies are `{ userId }` and never a password.

#### 2. Ban, unban, delete, change email

**File**: `supabase/functions/admin-users/handler.ts`

**Intent**: Perform the four operations under the existing admin gate, and refuse anyone this slice must not touch.

**Contract**: The directory lookup used for these operations also reads `is_service_account` and `banned_at`. Each operation returns 404 when the directory has no row.

Refusals, all 409, with a closed `error` code the courier will map:

- `last_admin` — the deactivation update raised `PT409`, or delete's predicate matched (the target is an admin, `deactivated_at` is null, `must_change_password` is false, and no other admin is in that state).
- `email_exists` — `change_email` and some directory row already has that address, including the target's own.
- `not_allowed` — machine, service account, an invitation (`isRevocable`), no role and not a temporary password (`must_change_password` with `invited_at` null), ban or delete of the caller, ban of a row that already has `banned_at`, unban of a row that does not.

Ban then: session update of `deactivated_at` to timestamp `T` when a role row exists and `deactivated_at` is null; secret-key update of `banned_at` to `T`; `updateUserById` with the permanent `ban_duration` from the current Admin API reference; insert `account_banned` with the verified admin as actor. On a GoTrue failure, clear `banned_at` and clear `deactivated_at` only if this call set it. Unban: `ban_duration: "none"`, then clear `banned_at`, and clear `deactivated_at` only when the two timestamps are equal, then insert `account_unbanned`. Delete: insert `account_deleted`, then `deleteUser`. `change_email`: `updateUserById({ email, email_confirm: true })`, then insert `email_changed`. History inserts use `recordAccess` with the new kinds. A secret-key write that skips that call would be recorded as the operator, so these paths do not skip it.

#### 3. Integration coverage

**File**: `src/test/admin-users.integration.test.ts`

**Intent**: Pin the HTTP behaviour, the rollback, and the silence of the mailer.

**Contract**: Extend the existing suite. Cover: ban then unban of an active user returns them to an active role row with both timestamps null; ban of an already deactivated user leaves `deactivated_at` unchanged across unban; ban of a temporary-password account with a role and of one without; 409 `last_admin` for ban and delete of the last active admin, with the account still present; 409 `not_allowed` for self, a machine user, the service account, each invitation state, and a no-role finished account; delete removes the auth user, leaves a plan they created in place with `created_by` null, and leaves `account_deleted` with a null target and the admin as actor; `change_email` updates the directory address, records `email_changed`, allows the caller's own address, and returns 409 `email_exists` when the address is taken. After `change_email`, Mailpit mail to the old and new addresses contains no confirmation link (`token_hash` or `/auth/confirm`). A notice with no link may be present. Restart the edge runtime before the run.

### Success Criteria:

#### Automated Verification:

- `mise run functions:check` passes.
- `pnpm exec vitest run src/test/admin-users.integration.test.ts` passes, including the ban, unban, delete, email, refusal, surviving-plan, and Mailpit cases above.
- A banned user's published-key request for a plan is refused on the next call, by the deactivation fence, in that same suite.

#### Manual Verification:

- None. The page still has no control for these operations.

**Implementation Note**: After this phase's automated checks pass, continue to Phase 3. Restart the edge runtime after every function edit before re-running the suite.

---

## Phase 3: Users page

### Overview

The admin can run the four operations from the Users table. Each destructive step is confirmed in a dialog that names the address. Change email asks for the address twice.

### Changes Required:

#### 1. Actions and courier

**File**: `src/_pages/users/model/schemas.ts`
**File**: `src/_pages/users/api/actions.ts`
**File**: `src/_pages/users/api/user-client.ts`
**File**: `src/_pages/users/api/invoke-admin-users.ts`
**File**: `src/_pages/users/api/account-error.ts`
**File**: `src/_pages/users/api/constants.ts`
**File**: `src/actions/action-capabilities.test.ts`

**Intent**: The page calls the function through Astro Actions, the same courier as revoke, and turns the function's statuses into fixed sentences.

**Contract**: Four actions, each `requires: "manage_users"`: `banUser`, `unbanUser`, `deleteAccount` take `{ userId }`; `changeUserEmail` takes `{ userId, email }` using the existing normalised email field. The form schema for change email adds `confirmEmail` and the same mismatch refinement as `createAccountFormSchema`. The action input does not include the confirmation. The courier reads a closed `error` code on 409 (`last_admin`, `email_exists`, `not_allowed`) and maps it to local copy: `last_admin` reuses `LAST_ADMIN_MESSAGE`, `email_exists` reuses `EMAIL_EXISTS_MESSAGE`, `not_allowed` is a new sentence that the account cannot be changed that way. The function's text is never shown. `action-capabilities.test.ts` lists the four as `manage_users`.

#### 2. Row flags

**File**: `src/_pages/users/model/user-rows.ts`
**File**: `src/_pages/users/model/user-rows.test.ts`

**Intent**: The buttons follow the package chosen for this slice, and the table does not decide the last-admin case.

**Contract**:

- Active, and not the service account: Ban, Delete, Change email, and the existing Deactivate.
- Deactivated, and not the service account: Ban, Delete, Change email, and the existing Reactivate.
- Temporary password: Ban, Delete, Change email, and the existing Re-issue.
- Banned: Unban, Delete, Change email. No Ban, Deactivate, Reactivate, or Re-issue.
- The caller's own row: Change email, and none of Ban or Delete. Deactivate stays hidden, as today.
- Invitations, the service account, and a row with no role: none of the four new actions. Revoke and Deactivate stay as they are.

#### 3. Dialogs and table

**File**: `src/_pages/users/ui/UserTable.tsx`
**File**: `src/_pages/users/ui/UsersPage.tsx`
**File**: `src/_pages/users/ui/ConfirmBanDialog.tsx`
**File**: `src/_pages/users/ui/ConfirmUnbanDialog.tsx`
**File**: `src/_pages/users/ui/ConfirmDeleteAccountDialog.tsx`
**File**: `src/_pages/users/ui/ChangeEmailDialog.tsx`
**File**: `src/_pages/users/model/use-account-actions.ts`

**Intent**: Offer the actions the flags allow, and confirm each one the way Deactivate and Revoke are confirmed.

**Contract**: Link buttons in the status cell, with an accessible name that includes the person's label. Ban, Unban, and Delete use an alert dialog that names the email. Ban's copy says sign-in stops and access ends on their next action. Unban's copy says a pause that was already in place stays. Delete's copy says the account is removed and their plans stay. Change email is a form dialog with the address and its confirmation, `mode: "onTouched"`, and it shows the address that will replace the current one. Success toasts and reloads the list, following the deactivate hook. The role picker is not given `banned_at`. Style with the semantic tokens the existing dialogs use.

### Success Criteria:

#### Automated Verification:

- `pnpm exec vitest run src/_pages/users/model/user-rows.test.ts src/_pages/users/ui/UserTable.test.tsx src/_pages/users/ui/UsersPage.test.tsx src/_pages/users/api/invoke-admin-users.test.ts src/actions/action-capabilities.test.ts` passes.
- The table tests cover Ban, Unban, Delete, and Change email on the rows in the contract above, and their absence on an invitation, the service account, a no-role row, and the admin's own Ban and Delete.
- `pnpm check` passes.
- `pnpm steiger` passes.

#### Manual Verification:

- Ban an active colleague from the Users page. Their next request in that session reaches the no-access notice. Unban returns them to Active, and they can open a plan again.
- Deactivate a colleague, then ban them. The row says Banned. Unban leaves the row Deactivated, and Reactivate is what restores them.
- Delete a temporary-password account created with a mistyped address. The row disappears. A plan that account created is still listed, credited to Unknown.
- Change a colleague's email, typing it twice. The row shows the new address. A mismatched confirmation does not submit. An address already on the list is refused with the existing "already exists" sentence.
- Ban the last active admin. The dialog closes with "The school must keep at least one admin." and the account is unchanged.
- As a viewer, the Users page is unchanged: no ban, delete, or email control.

**Implementation Note**: After the automated checks pass, pause for the manual pass before Phase 4. The manual pass needs the local stack, the restarted edge runtime, and an admin session.

---

## Phase 4: Docs that name this slice

### Overview

The contributor guide, the email-link comment, the credit comment, and the two runbooks describe what this slice decided, so the next change does not treat a link type, a password reset, or a "Deleted user" label as still owed.

### Changes Required:

#### 1. Runbooks

**File**: `docs/runbooks/hosted-auth-settings.md`
**File**: `docs/runbooks/author-provisioning.md`

**Intent**: Stop promising an admin reset of a confirmed password, and stop saying this slice may send a `redirectTo` or that account deletion is still unguarded.

**Contract**: The forgotten-password paragraphs name the owner's reset and Re-issue for a temporary password, and the dashboard as an action outside the app. They do not say S-411 will add an admin-side reset. The `uri_allow_list` note no longer says S-411 may send a `redirectTo`. The assign-role section says this script does not delete accounts, and the Users page refuses banning or deleting the last active admin.

#### 2. Comments and the contributor guide

**File**: `CLAUDE.md`
**File**: `src/_pages/password-recovery/model/email-link.ts`
**File**: `src/entities/user/model/credit.ts`
**File**: `src/_pages/users/model/schemas.ts`

**Intent**: Drop the sentences that describe this slice as future work, and replace them with the decision.

**Contract**: Update each of these in place:

- `CLAUDE.md` on the last admin: the function refuses banning or deleting the last active admin; the cascade guard still lets `deleteUser` through.
- `CLAUDE.md` on the directory mirror: an email change is an Auth update, and the existing mirror follows the address. This slice does not re-create the function.
- `CLAUDE.md` on email links: this slice does not add `email_change`. The sentence that says a new type joins `EMAIL_LINK_TYPES` stays true for a future type, without naming this slice.
- `CLAUDE.md` on revoke: confirmed accounts and temporary-password accounts are removed by `delete`.
- `CLAUDE.md` on the three fence functions: the next slice that edits them re-creates them from `20261112110654_deactivation_fence.sql`. This slice did not edit them.
- `email-link.ts`: the comment no longer says S-411 adds `email_change`. The unit test that refuses that type stays.
- `credit.ts`: Unknown includes a deleted person, and this slice keeps it that way.
- `schemas.ts`: the create-account comment no longer says deletion waits for S-411.

### Success Criteria:

#### Automated Verification:

- `pnpm exec vitest run src/_pages/password-recovery/model/email-link.test.ts` passes, and `email_change` is still refused.

#### Manual Verification:

- Grep `S-411` in `CLAUDE.md`, `docs/runbooks/hosted-auth-settings.md`, and `docs/runbooks/author-provisioning.md`. Each remaining hit describes a rule this slice put in place, or a file a later slice must copy from. None promise a password reset, an email-change link, or a "Deleted user" label.

**Implementation Note**: This phase is prose and comments. It can land with Phase 3's commit or just after the manual pass.

---

## Testing Strategy

### Unit Tests:

- Parser: the four shapes, a missing field, an unknown key, and an email that does not parse.
- `statusOf` and the capability flags, one case per status in the Phase 3 contract, plus Banned ahead of a pending password and ahead of deactivation.
- Reactivate reads `banned_at` and refuses while it is set. The role upsert payload stays `{ user_id, role }`.
- Courier: 409 `last_admin`, `email_exists`, and `not_allowed` map to the local sentences, and a body that is not one of those codes does not reach the toast.

### Integration Tests:

- The Phase 2 list on `src/test/admin-users.integration.test.ts`.
- `set-user-active` and `change-user-role` against a row with `banned_at` set.
- No new role-matrix principal. `deactivatedAdmin` already describes a banned admin.

### Manual Testing Steps:

1. Ban, confirm the no-access notice on the banned person's next request, and unban back to Active.
2. Ban someone who was already deactivated, and unban back to Deactivated.
3. Delete a mistyped temporary-password account and confirm their plan remains, credited Unknown.
4. Change an email with a matching confirmation, a mismatched one, and a taken address.
5. Ban the last active admin and read the existing last-admin sentence.
6. Open the Users page as a viewer and confirm the new controls are absent.

## Performance Considerations

The Users page already loads every directory row and every history row, at a school of tens of people. `banned_at` is one more column on that read. Nothing on the planner path changes, and the drag-drop budget is untouched.

## Migration Notes

The migration is additive: a nullable column and four enum labels. It is safe on the hosted database, which applies pending migrations on merge to `main`. Existing accounts have `banned_at` null and keep their current status. There is no backfill. Do not re-create the mirror or the fence functions in this migration. Regenerate `database.types.ts` after it applies and commit that diff.

Hosted auth settings do not change. No template, no `uri_allow_list` edit, no `config push`.

## References

- Research: `context/changes/remove-and-correct-accounts/research.md`
- Revoke's record-then-delete order: `supabase/functions/admin-users/handler.ts`
- Last-admin predicate and the cascade exemption: `supabase/migrations/20261112110654_deactivation_fence.sql`
- Directory mirror column list: `supabase/migrations/20261111074135_invitations.sql`
- Status derivation: `src/_pages/users/model/user-rows.ts`
- Courier status mapping: `src/_pages/users/api/account-error.ts`
- Admin API: `updateUserById` `email_confirm` sets the address confirmed and does not send a confirmation; `ban_duration: "none"` clears a ban. Confirmed against the Supabase Admin API reference and the managing-user-data guide during planning (2026-11-13).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Remember a ban

#### Automated

- [x] 1.1 The migration applies on the local stack with `pnpm exec supabase migration up` — 5ac1a9bd
- [x] 1.2 `pnpm db:types` produces `banned_at` and the four new `access_change_kind` labels, and the committed file matches — 5ac1a9bd
- [x] 1.3 `pnpm exec vitest run src/_pages/users/model/user-rows.test.ts src/_pages/users/api/set-user-active.test.ts` passes, including Banned ahead of Deactivated and Temporary password, and reactivate refusing when `banned_at` is set — 5ac1a9bd
- [x] 1.4 `pnpm exec vitest run src/_pages/users/api/set-user-active.integration.test.ts src/_pages/users/api/change-user-role.integration.test.ts` passes: a row with `banned_at` set is not reactivated, and a role change leaves `banned_at` set — 5ac1a9bd
- [x] 1.5 `pnpm check` passes — 5ac1a9bd

### Phase 2: Four operations on admin-users

#### Automated

- [x] 2.1 `mise run functions:check` passes — da89d361
- [x] 2.2 `pnpm exec vitest run src/test/admin-users.integration.test.ts` passes, including the ban, unban, delete, email, refusal, surviving-plan, and Mailpit cases — da89d361
- [x] 2.3 A banned user's publishable-key request for a plan is refused on the next call, by the deactivation fence, in that same suite — da89d361

### Phase 3: Users page

#### Automated

- [x] 3.1 `pnpm exec vitest run src/_pages/users/model/user-rows.test.ts src/_pages/users/ui/UserTable.test.tsx src/_pages/users/ui/UsersPage.test.tsx src/_pages/users/api/invoke-admin-users.test.ts src/actions/action-capabilities.test.ts` passes — 6a6ab95e
- [x] 3.2 The table tests cover Ban, Unban, Delete, and Change email on the contracted rows, and their absence on an invitation, the service account, a no-role row, and the admin's own Ban and Delete — 6a6ab95e
- [x] 3.3 `pnpm check` passes — 6a6ab95e
- [x] 3.4 `pnpm steiger` passes — 6a6ab95e

#### Manual

- [ ] 3.5 Ban an active colleague, confirm their next request has no access, and Unban restores them to Active
- [ ] 3.6 Ban a deactivated colleague and Unban leaves them Deactivated
- [ ] 3.7 Delete a temporary-password account and confirm a plan they created remains, credited Unknown
- [ ] 3.8 Change an email typed twice, refuse a mismatch and a taken address, and show the new address on the row
- [x] 3.9 Ban the last active admin and read "The school must keep at least one admin." with the account unchanged — not reachable from the page (the caller always counts as an active admin, and Ban is hidden on their own row); covered by `supabase/functions/admin-users/last-admin.test.ts`, see `reviews/impl-review.md` F4
- [ ] 3.10 As a viewer, the Users page shows no ban, delete, or email control

### Phase 4: Docs that name this slice

#### Automated

- [x] 4.1 `pnpm exec vitest run src/_pages/password-recovery/model/email-link.test.ts` passes, and `email_change` is still refused — b69cd1ca

#### Manual

- [x] 4.2 Grep of `S-411` in `CLAUDE.md` and the two runbooks leaves only rules this slice put in place, with no promised password reset, email-change link, or "Deleted user" label — b69cd1ca
