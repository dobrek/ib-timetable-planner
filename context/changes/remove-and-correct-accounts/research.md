---
date: 2026-11-13T11:36:08+01:00
researcher: Grok 4.7
git_commit: 83a986f93d381d2f39af8d14feca8ddede17700e
branch: s-411-ban-delete-and-change-email-for-existing-a
repository: ib-timetable-planner
topic: "Feasibility of S-411: ban or delete a confirmed account, and change a user's email"
tags: [research, codebase, auth, admin-users, ban, delete, email-change, last-admin, access-changes, gotrue]
status: complete
last_updated: 2026-11-13
last_updated_by: Grok 4.7
---

# Research: Feasibility of S-411, remove and correct accounts

**Date**: 2026-11-13T11:36:08+01:00
**Researcher**: Grok 4.7
**Git Commit**: [`83a986f`](https://github.com/dobrek/ib-timetable-planner/commit/83a986f93d381d2f39af8d14feca8ddede17700e)
**Branch**: s-411-ban-delete-and-change-email-for-existing-a
**Repository**: ib-timetable-planner

## Research Question

Is S-411 feasible — an admin bans or deletes a confirmed account and changes a user's email, access ends within an hour, machine users cannot be touched, deleting a person never deletes a timetable, and every change records who made it and when — and which challenges does it face, with an option for each?

## Summary

S-411 is feasible on the machinery S-409 and S-410 already shipped. Add four operations to the existing `admin-users` function (`ban`, `unban`, `delete`, `change_email`). Do not add a second Edge Function, and do not put the secret key in the Worker. Timetables already survive a user delete: plan and job credit columns are `ON DELETE SET NULL`.

The work is constrained, not blocked. Six challenges decide the shape:

1. **The database will not refuse deleting the last admin.** That exemption is deliberate, so teardown and `deleteUser` keep working. The function has to refuse, before it calls GoTrue.
2. **A ban does not end an existing session.** Current Supabase docs say a ban only blocks sign-in and refresh. An access token already issued stays valid until it expires, and this project's expiry is one hour. A local probe on auth v2.189.0 also saw `getUser()` and PostgREST accept a pre-ban token. Deactivation, already shipped, is what cuts data access on the next request.
3. **There is no admin API that sends an email-change confirmation.** `generateLink` returns a link and sends nothing. `updateUserById` is the admin path that changes the address. A double-confirm flow would need a mail sender this function does not have.
4. **A deletion record loses the person it names.** `access_changes.target_id` is set to null when the account goes, which is the ids-only rule S-406 recorded and S-410 already accepted for revoke.
5. **A deleted creator reads "Unknown",** the same as a row that predates attribution, and their running job becomes stoppable by any author. Both were accepted earlier and left for this slice to revisit.
6. **Two runbooks promise an admin password reset of a confirmed account "until S-411".** The roadmap outcome does not include it. S-409 moved it here because it lets an admin take over a live account.

Recommended shape, so a plan can start from a decision rather than a survey:

| Challenge | Recommended option |
| --- | --- |
| Where the code lives | New ops on `admin-users`, copying revoke's lookup → refuse → record → Admin API order |
| Last admin | Refuse in the function. Do not add a raising trigger on `auth.users` |
| Ban vs the one-hour window | Ban in GoTrue **and** set `deactivated_at` through the admin's session, so the cutoff does not depend on the auth-server version. Unban clears both. Deactivate stays the reversible pause that does not ban |
| Email change | Admin API sets the new address immediately (`email_confirm: true`), after a type-twice check and a refusal when the address is taken. No new link type |
| Removal audit | Keep ids only. The record keeps who acted and when; the target becomes null |
| "Deleted user" on plans | Keep "Unknown". Do not add kind columns in this slice |
| Confirmed-account password reset | Leave it out, and correct the two runbook lines |

## Detailed Findings

### What the slice is

Roadmap S-411 (`context/foundation/roadmap.md`, "Remove and correct accounts") asks for ban, delete of a confirmed account, and an email change. Prerequisites are done: S-409 proved the secret-holding function, S-410 proved invite, resend and revoke, S-408 proved the immediate deactivation fence. Revoking a never-confirmed invitation stays S-410's.

PRD requirements that bind the slice:

- FR-404: an admin can ban or delete an account. The shaping note accepted that this is not immediate: an issued token can live up to an hour. Immediate cutoff was left to FR-407, which S-408 already shipped.
- FR-414: an admin can change a user's email. It was narrowed from self-service to admin-only. The shaping note called double confirmation a real cost; it did not require it.
- Non-functional: after a ban or delete, access ends within at most one hour. Every access change (including email, ban and delete) can show who made it and when.

No ban, delete or change-email control exists. The Users table offers Re-issue, Re-send, Revoke, Deactivate and Reactivate ([`UserTable.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/_pages/users/ui/UserTable.tsx#L83-L154)). The function's parser accepts create, reissue, invite, resend and revoke only.

### Challenge 1 — Last-admin deletion is allowed on purpose

`guard_last_admin()` returns early when a delete is a cascade (`pg_trigger_depth() > 1` and the `auth.users` row is already gone) ([`20261112110654_deactivation_fence.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261112110654_deactivation_fence.sql#L106-L110)). The migration that introduced the exemption says why: refusing the cascade would break `auth.admin.deleteUser`, the test teardown, and this slice's own delete. Refusing to delete the last admin's account "belongs to S-411's own component" ([`20261105080343_role_management.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261105080343_role_management.sql#L36-L46)).

The same early return means the cascade writes no `role_removed` row. Recording it would insert an `access_changes` row whose `target_id` points at a user being deleted, the foreign key would refuse the insert, and the deletion would abort.

A ban does not touch `user_roles`, so a banned admin still counts as active. `current_app_role()` knows about `deactivated_at` and `must_change_password`. It does not know about `banned_until`.

**Options**

| Option | What it does | Why to take it or leave it |
| --- | --- | --- |
| **A. Refuse in the function (recommended)** | Before `deleteUser` or the ban call, refuse when the target is the last admin who is neither pending nor deactivated — the same predicate the guard uses. Take advisory lock `406001` so two admins cannot pass the count together | Matches the recorded hand-off. Leaves teardown and dashboard deletes working. The check and GoTrue's delete are still two steps, the same race revoke already accepts ([`handler.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/functions/admin-users/handler.ts#L30-L32)) |
| B. Remove the role (or set `deactivated_at`) through the admin's session first, then call GoTrue | The existing trigger takes the lock and raises `PT409` for the last admin. No new count | Closes the race the lock was built for. If GoTrue then fails, the person has lost the role or been deactivated while the account still exists. The function would have to put the role back |
| C. A `BEFORE DELETE` trigger on `auth.users` | The only fully atomic refusal | Also blocks teardown, the dashboard, and any service-role delete. Sits on GoTrue's write path. The cascade exemption exists so this does not happen |

Also refuse ban and delete when the target is the caller. Deactivate already hides that button on your own row ([`UserTable.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/_pages/users/ui/UserTable.tsx#L126)). The function should repeat the refusal: the UI is not the enforcement.

### Challenge 2 — A ban does not cut off a token already issued

Supabase's current account-removal guide (fetched 2026-11-13 from the managing-user-data guide) says:

- A ban blocks sign-in for its duration and does not revoke existing sessions.
- Deleting the user removes `auth.sessions`, so no new access token can be minted.
- Neither action invalidates an access token already in someone's hands. The JWT stays valid until `exp`.

This repo sets `jwt_expiry = 3600` ([`config.toml`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/config.toml#L163)). The one-hour guardrail therefore holds for a ban even when nothing else is done.

The app does not rely on the JWT alone for data. Middleware calls `getUser()` on every request ([`middleware.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/middleware.ts#L80-L90)), then reads the role live. On local auth v2.189.0 a pre-ban token still passed both `getUser()` and PostgREST (`context/changes/user-managment-research/research.md`, probe 3). Refresh and sign-in returned `user_banned`. Whether today's hosted auth server rejects that token inside `getUser()` is the roadmap's open question. PostgREST acceptance until `exp` is what the current docs guarantee. Because the publishable key never reaches the browser, the practical path is the Worker — but a ban that leaves the role row in place still authorises data for as long as `getUser()` succeeds.

Delete is stricter in this app than the JWT rule suggests. `user_roles`, `user_directory` and `profiles` cascade, so `current_app_role()` finds nothing on the next request and RLS fails closed. The outstanding JWT cannot read plans after the role row is gone.

**Options**

| Option | What it does | Why to take it or leave it |
| --- | --- | --- |
| **A. Ban and deactivate together (recommended)** | `ban` sets `deactivated_at` through `ctx.supabase` (the guard, the immediate fence, the existing `deactivated` record) and then sets GoTrue's ban. `unban` clears both. Deactivate stays a separate action that does not ban | Data access ends on the next request even when `getUser()` still returns the user. The last-admin guard applies, because deactivation is a write it already judges. Retires the hosted-version unknown. Reactivate must refuse while the GoTrue ban is still set, or it would lift the fence and leave the ban — today's reactivate only clears `deactivated_at` ([`set-user-active.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/_pages/users/api/set-user-active.ts#L43-L53)) |
| B. Ban only | `updateUserById({ ban_duration })`. Sign-in and refresh stop. Data access lasts until the token expires | Smallest, and it matches the residual FR-404 already accepted. Leaves the roadmap unknown in place, and a banned last admin still counts as active unless the function checks |
| C. Teach `current_app_role()` about `banned_until` | Mirror the column, re-create the fence functions from `20261112110654_deactivation_fence.sql`, add a role-matrix principal | Same immediate cutoff as A, plus a new DEFINER-function edit and a matrix row. A is the same cutoff without touching the one DEFINER function |

`user_directory` does not mirror `banned_until` today. The mirror's latest body is [`20261111074135_invitations.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261111074135_invitations.sql#L68-L110). Re-create it from that body, not from the original directory migration, and only if the page must show a ban that GoTrue holds and the app does not. Option A can show "Banned" from the new `account_banned` record plus `deactivated_at`, without a new mirrored column. The mirror must never raise: a failure fails GoTrue's own write.

Nothing in the repo reads or writes `ban_duration`. The plan should take the permanent-ban and unban spellings from the current Admin API (`ban_duration`, with `none` as the documented way to clear it) and pin them with one integration test, rather than invent a duration.

### Challenge 3 — Email change has no admin "send the mail" call

FR-414 is admin-only. The account page can change a password and a display name. It cannot change an email.

What GoTrue offers, from current docs:

- `auth.admin.updateUserById(id, { email })` is the admin method that changes the address. `email_confirm: true` marks it confirmed and does not start a confirmation flow.
- `generateLink` supports `email_change_current` and `email_change_new` and **does not send**. The caller would have to mail the links. This function has no Resend or SMTP secret. The only send it performs today is `inviteUserByEmail`, which has no email-change equivalent.
- Secure email change (`double_confirm_changes = true`, already set locally at [`config.toml`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/config.toml#L216)) sends two messages when a **signed-in user** changes their own email. That path is the one FR-414 moved away from.

The directory already follows `auth.users.email`. The update trigger's column list includes `email` ([`20261111074135_invitations.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261111074135_invitations.sql#L100-L110)). An admin update is visible on the Users page in the same transaction. No mirror change is required for the address itself.

`EMAIL_LINK_TYPES` is `recovery` and `invite` ([`email-link.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/_pages/password-recovery/model/email-link.ts#L1-L8)). The comment names `email_change` as this slice's type, and the unit test asserts it is refused. That comment describes the link path. It is not a requirement once the slice does not send a link. CLAUDE.md's email-link paragraph should be updated in the same change so the next slice does not treat a link type as mandatory. The lesson on conventions that cite a mechanism applies: the sentence is coupled to a flow this slice may not build.

**Options**

| Option | What it does | Why to take it or leave it |
| --- | --- | --- |
| **A. Set the address now (recommended)** | `updateUserById({ email, email_confirm: true })`, write `email_changed` first, refuse a machine, a service account, and an address another directory row already holds. Echo the new address and require it typed twice, the guard create already uses because a typo could not be undone | No new sender, no template, no confirm-page state. The mirror follows. A typo still locks the person out of sign-in and reset, which is why the confirm step has to show the address. Prove in the integration test that Mailpit receives nothing, so a later GoTrue change cannot start a confirm flow unnoticed |
| B. Double confirm, both inboxes | `generateLink` for the current and new address, then mail both ourselves | Proves the new mailbox and warns the old one. Needs a mail sender and a secret the function does not hold, plus a confirm-page success state that is not "you are now signed in". `verifyOtp` today treats success as a session ([the confirm route](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/pages/api/auth/confirm.ts)) |
| C. Link to the new address only | Generate one link, send it ourselves, change the address only after it is spent | Proves the new mailbox. Same missing sender as B, plus a pending address the directory does not store |

Hosted templates are updated by the Management API, never `config push` (`docs/runbooks/hosted-auth-settings.md`). Option A does not add a template. The runbook's line that "S-411 may" read `uri_allow_list` applies only if a flow sends `redirectTo`. Invite and recovery build their links from `{{ .SiteURL }}` and do not.

The platform's "your email was changed" notification is a hosted setting (`mailer_notifications_email_changed`). Use it only if a local admin update actually produces that message. If it does not, ship option A without a notification rather than adding a sender for a rare correction.

### Challenge 4 — The audit row cannot keep the deleted person

`access_changes` stores ids, never an email. Both `actor_id` and `target_id` use `ON DELETE SET NULL` ([`20261105080343_role_management.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261105080343_role_management.sql#L48-L52)). Revoke already writes the record and then deletes, and the target becomes null ([`handler.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/functions/admin-users/handler.ts#L231-L242)). The Users loader drops records whose target is null, so a deleted person disappears from the page together with the row that said who removed them. The table still holds the actor, the kind and the time, which is the trace S-406 called queryable.

New kinds are `alter type … add value`, usable only after that migration commits. The deactivation migration already shows the post-condition: look the label up, never cast it in the same transaction. S-406's enum comment reserved room for this slice's kinds. Concrete names to add: `account_banned`, `account_unbanned`, `account_deleted`, `email_changed`. The function writes them with the verified admin as actor, the way `recordAccess` already does. A secret-key write that skips that call is recorded as the operator.

**Options**

| Option | What it does | Why to take it or leave it |
| --- | --- | --- |
| **A. Keep ids only (recommended)** | Same as revoke. Decide it once for revoke and delete, which is the joint decision S-410 deferred ([`20261111074135_invitations.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261111074135_invitations.sql#L40-L43)) | Preserves the recorded privacy rule. The non-functional line is met by the table: who acted, and when. The page does not gain a "removed people" list |
| B. Snapshot `target_email` on removal kinds | The row still names the address after the account is gone | Reverses an explicit ids-only decision. Needs a stated reason; the school is in the EU and the original rule exists so an ex-staff address is not kept |
| C. A retention window, then null the snapshot | Keeps the address for a while | A new job, and still a reversal of the ids-only rule for that window |

An email change can record the fact without the addresses. The directory holds the new address; the old one is not required for "who changed it and when".

### Challenge 5 — Deleting a person must not delete a timetable

This is already true, and the slice should not reopen it.

| Table | On delete of `auth.users` | Where |
| --- | --- | --- |
| `profiles`, `user_roles`, `user_directory` | CASCADE | profiles, user_roles, user_directory migrations |
| `access_changes.actor_id`, `target_id` | SET NULL | role-management migration |
| `plans.created_by` | SET NULL | [`20261106192749_created_by_and_job_ownership.sql`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/supabase/migrations/20261106192749_created_by_and_job_ownership.sql#L104) |
| `generation_jobs.requested_by`, `stop_requested_by` | SET NULL | same migration, lines 128–129 |

No timetable table points at `auth.users`. Placements hang off plans and courses. A soft delete (`should_soft_delete`) is an update that obfuscates the email and skips the cascade. Nothing in the repo uses it. Use hard `deleteUser`, the same call revoke uses.

The set-null is why a deleted creator and a pre-S-407 row look the same. `Credit` documents that, and names this slice as the one that may tell them apart ([`credit.ts`](https://github.com/dobrek/ib-timetable-planner/blob/83a986f93d381d2f39af8d14feca8ddede17700e/src/entities/user/model/credit.ts#L15-L18)). S-407 accepted "Unknown" and "any author may stop" as the safe direction: an orphaned job stays stoppable.

**Options**

| Option | What it does | Why to take it or leave it |
| --- | --- | --- |
| **A. Keep "Unknown" (recommended)** | No new columns. The roadmap unknown stays decided as "accept" | No service-role insert has to learn a new kind. The stop rule stays the safe one |
| B. A kind column beside each credit | `creator_kind` and the job equivalents, copied from `access_changes.actor_kind`, so the UI can say "Deleted user" | Additive, but every writer of those columns, including the solver's service role, has to set the kind. Out of proportion for a label |

### Challenge 6 — Who the new operations may touch

- **Machine users** are hidden by the directory's read policy, and the function refuses them explicitly because the secret-key client can see them. Every new op needs the same `is_machine` refusal. A lookup through the admin's session would 404 instead of 409.
- **The calibration service account** is an ordinary author with a badge (`app_metadata.service_account`). Nothing stops Deactivate on it today. Ban, delete and email change should refuse it: the campaign runbook owns that identity.
- **Pending invitations** stay on revoke. Revoke refuses a confirmed account, a temporary-password account and a machine. Delete should cover confirmed accounts and temporary-password accounts (the create dialog types the address twice because a typo cannot be removed until this slice). It should refuse invitees, and send the admin to Revoke.
- **The caller.** Refuse ban and delete of yourself. Allow an admin to correct their own email.
- **Password reveal** stays on create and reissue only. The new ops return `{ userId }`.

### Challenge 7 — A confirmed-account password reset was parked here

S-409's plan moved "reset any confirmed account's password" to S-411, because it lets an admin take over a live account (`context/archive/2026-11-08-create-account-fallback/plan.md`). Re-issue stays limited to accounts that still have the temporary-password fence. Two runbooks still say the dashboard is the fallback until S-411 adds an admin-side reset (`docs/runbooks/hosted-auth-settings.md`, `docs/runbooks/author-provisioning.md`).

The roadmap outcome does not mention a password reset. **Leave it out.** Correct both runbook lines so they stop promising it. Adding it is a separate decision, closer to an account takeover than to FR-404 or FR-414.

### What a plan can reuse unchanged

- The function's admin gate: `own_app_role()` must answer `admin` before the secret-key client is used. A pending or deactivated admin reads null. The solver's machine token passes the platform JWT check and then fails this one.
- Two identities: role and deactivation writes through `ctx.supabase`, so the trigger attributes them and the guard runs. Auth Admin, directory lookups and explicit audit rows through `ctx.supabaseAdmin`.
- `deleteUser`, already used by revoke and by teardown.
- The scanner-safe confirm page, the 24-hour / 10-digit link policy, and the template runbook — needed only if the email option changes from A.
- CI already deploys `admin-users`. A new function would need a stack restart, a config block, a Dependabot entry and a deploy step, and would duplicate the gate.

If the fence functions are edited, re-create them from `20261112110654_deactivation_fence.sql`, which says so in its header. The recommended options do not need to edit them. If the mirror is edited, re-create it from `20261111074135_invitations.sql`.

## Code References

- `supabase/functions/admin-users/handler.ts:30-32` — revoke does not remove confirmed accounts; this slice does.
- `supabase/functions/admin-users/handler.ts:231-242` — record, then `deleteUser`; the target id becomes null.
- `supabase/migrations/20261105080343_role_management.sql:36-62` — cascade exemption, ids-only records, enum values added by later slices.
- `supabase/migrations/20261112110654_deactivation_fence.sql:50-51` — S-411 re-creates the three fence functions from this file if it touches them.
- `supabase/migrations/20261112110654_deactivation_fence.sql:106-120` — cascade early return, then the "still an active admin?" predicate.
- `supabase/migrations/20261111074135_invitations.sql:30-43` — mirror follows GoTrue; email snapshot on removal is this slice's decision.
- `supabase/migrations/20261106192749_created_by_and_job_ownership.sql:104` — `plans.created_by` set null on delete.
- `src/_pages/users/ui/UserTable.tsx:83-154` — current row actions; no ban, delete or change-email.
- `src/_pages/users/api/set-user-active.ts:43-53` — reactivate clears `deactivated_at` and would leave a GoTrue ban in place.
- `src/_pages/password-recovery/model/email-link.ts:1-8` — link types today; `email_change` is named and not accepted.
- `src/entities/user/model/credit.ts:15-18` — "Unknown" includes deleted people; telling them apart is this slice's decision.
- `src/middleware.ts:80-90` — every request calls `getUser()` before the role read.
- `supabase/config.toml:163` — access tokens last one hour.
- `supabase/config.toml:216` — secure email change (both addresses) is on locally, for a user-initiated change.

## Architecture Insights

- **One function, more ops.** S-409 and S-410 already treated `admin-users` as the only secret-holding component. A ban or a delete is another `op`, with the same admin check, the same two clients, and the same "record before the destructive call" order.
- **Enforcement that must survive a cascade lives in the function.** The trigger cannot refuse an account deletion without breaking deletion itself. The function is the layer that still sees the admin and the target.
- **Immediate cutoff is a role-row fact, not a GoTrue fact.** `deactivated_at` is read by `current_app_role()` on the next request. A GoTrue ban is read by the auth server at sign-in and refresh. The one-hour JWT gap sits between them. Composing the two, inside one operation, is how a ban meets an admin's expectation without a new DEFINER function.
- **The directory mirror is the Users list.** Email is already in its trigger. Ban state is not. Prefer not to extend the mirror unless the page cannot derive the status from columns and records it already has.
- **Access-control changes start in the role matrix.** A new fence inside `current_app_role()` would need a red expectations diff first. The recommended ban does not add one: it reuses deactivation, which the matrix already pins.

## Historical Context (from prior changes)

Decisions a plan should not reopen:

- Cascade exemption and "S-411 refuses the last admin in its own component" — `context/archive/2026-11-03-users-page-roles/plan.md`, and the role-management migration cited above.
- Secret-key writers record an explicit actor, or the row says operator — same archive.
- Ids only, no email on `access_changes` — same archive. S-410 kept that for revoke and deferred a snapshot to this slice (`context/archive/2026-11-10-invite-by-email/plan.md`).
- Revoke is unconfirmed invitees only — `context/archive/2026-11-10-invite-by-email/`.
- "Unknown" and "any author may stop" for a null requester — `context/archive/2026-11-06-created-by-and-job-ownership/plan.md`. Revisit was optional.
- Deactivation is not a ban. S-408 left pairing them to this slice (`context/archive` for deactivate-reactivate; the live fence is `20261112110654_deactivation_fence.sql`).
- Confirmed-account password reset is a takeover decision, not part of creating accounts — `context/archive/2026-11-08-create-account-fallback/plan.md`.
- Re-create SQL functions from the latest live body — `context/foundation/lessons.md`, "Re-create SQL functions from the latest live definition".

## Related Research

- `context/changes/user-managment-research/research.md` — the 2026-10-10 ban probe (pre-ban token still worked against `getUser()` and PostgREST on auth v2.189.0) and the original lifecycle options.
- `context/archive/2026-11-03-users-page-roles/research.md` — cascade, audit foreign keys, soft versus hard delete.
- `context/archive/2026-11-08-create-account-fallback/research.md` — why the fat function exists, and why a full reset moved here.
- `context/archive/2026-11-10-invite-by-email/research.md` — revoke's boundary, the shared mirror, and `email_change` joining the link types if a link is sent.

## Open Questions

None of these block a plan that follows the recommended column. They are the choices worth confirming before implementation:

1. **Ban composes with deactivation (recommended) or stands alone.** Alone matches the residual FR-404 accepted when deactivation was only a nice-to-have. Together makes the cutoff independent of the hosted auth version.
2. **Email is set immediately (recommended) or confirmed by link.** A link needs a sender this stack does not have.
3. **Removal records stay ids-only (recommended).** A snapshot reverses a recorded privacy rule.
4. **Deleted creators stay "Unknown" (recommended).**
5. **No admin reset of a confirmed password (recommended).** The runbooks need a correction either way.
6. **Unban is in scope (recommended with the paired ban).** A mistaken ban would otherwise be a dashboard action. Unban clears the GoTrue ban and `deactivated_at` together.
