# Remove and Correct Accounts — Plan Brief

> Full plan: `context/changes/remove-and-correct-accounts/plan.md`
> Research: `context/changes/remove-and-correct-accounts/research.md`

## What & Why

An admin needs to ban or delete an account and correct a user's email. Access has to end within an hour, machine users stay untouchable, deleting a person must not delete a timetable, and every change keeps who did it and when. The work is the rest of account removal: S-410 already revokes an invitation that was never finished.

## Starting Point

`admin-users` already creates accounts, re-issues a temporary password, and invites, re-sends, and revokes. Deactivation already cuts data access on the next request. The last-admin guard deliberately lets an account-deletion cascade through, so teardown and `deleteUser` keep working. The Users page has no ban, delete, or change-email action.

## Desired End State

From the Users page an admin bans, unbans, or deletes an active, deactivated, or temporary-password account, and sets a new email on those accounts or on their own. A banned row says Banned. Unban returns the person to Active, or to Deactivated when they were already paused. A deleted person's plans stay, credited Unknown. Invitations stay on Revoke.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the code lives | Four ops on `admin-users` | The secret key and the admin gate already live there. | Research |
| Who Ban and Delete touch | Active, deactivated, and temporary-password accounts | A mistyped temporary password can be removed; a live invite stays on Revoke. | Plan |
| Who Change email touches | Those accounts, plus the admin's own row | The admin can correct their own address; invitations are revoked and re-sent. | Plan |
| Last admin, self, machine, service account | Refused for ban and delete; service account and machine also refused for email; self may change email | The UI is not the enforcement, and the campaign account belongs to its runbook. | Research |
| Ban and the one-hour window | Ban also deactivates | Data access ends on the next request even when a pre-ban token is still accepted. | Research |
| How a ban is remembered | `user_directory.banned_at`, same timestamp as a pause the ban itself adds | Every account has a directory row, and Unban can see whether the pause was already there. | Plan |
| Unban | A row action | A mistaken ban does not require the dashboard. | Plan |
| Already paused, then banned | Status says Banned; Unban leaves the pause | A pause and a ban are different acts. | Plan |
| Email change | Set immediately, typed twice, refuse a taken address | The function has no mail sender, and `email_confirm: true` does not start a confirmation. | Research |
| Removal history | Ids only; the page does not list removed people | An ex-staff address is not kept. Who acted and when stay in the table. | Research |
| Deleted creator | Stays Unknown | A kind column would have to be set by every writer, including the solver. | Research |
| Confirmed password reset | Left out; the runbooks stop promising it | It is an account takeover, and the roadmap outcome does not include it. | Research |

## Scope

**In scope:** `ban`, `unban`, `delete`, and `change_email` on the existing function; the `banned_at` column and four history kinds; Users page actions and confirmations; runbook and comment corrections.

**Out of scope:** Password reset of a confirmed account. Confirmation links and templates. An address stored on the history. A "Deleted user" label. A second Edge Function. Editing the role function, the last-admin guard, or the directory mirror. Banning invitations, machine users, the service account, or a row with no role.

## Architecture / Approach

The admin's session writes `deactivated_at`, so the existing guard and history trigger attribute the pause. The secret-key client writes `banned_at`, calls the Auth Admin API, and inserts `account_banned`, `account_unbanned`, `account_deleted`, or `email_changed`. Ban updates those rows before the GoTrue call and rolls them back if GoTrue refuses. Delete records, then deletes, because the history row cannot name a user who is already gone. The page treats `banned_at` as its own status, ahead of Deactivated and Temporary password. Reactivate reads that column and refuses while it is set.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Remember a ban | The column, the history kinds, and the Banned status | A later edit of the mirror that assigns `banned_at` would clear it |
| 2. Four operations | Ban, unban, delete, and email change, proved by integration tests | The edge runtime serves stale code until it is restarted |
| 3. Users page | The buttons, confirmations, and the twice-typed email | A reactivate that ignores `banned_at` would restore data access under a GoTrue ban |
| 4. Docs | Runbooks and comments match the decisions | A leftover "until S-411" line sends the next slice after a reset this one refused |

**Prerequisites:** S-409 is done. The local stack can apply a migration and run the edge runtime.
**Estimated effort:** About three sessions across four phases. Phase 2 is the long one.

## Open Risks & Assumptions

- Current Auth source rejects a pre-ban token, and the local v2.189.0 probe did not. Deactivation is what cuts data access either way. PostgREST still accepts the JWT until it expires, which is at most an hour.
- Two admins can each pass the last-admin count and then delete the other. The same gap exists for revoke. A trigger on `auth.users` would also block teardown.
- A ban made in the Supabase dashboard does not set `banned_at`, so the page will not say Banned.
- If the history insert fails after GoTrue has banned the user, the ban stays and that one row is missing from the history.

## Success Criteria (Summary)

- An admin can ban, unban, delete, and correct an email from the Users page, and a viewer never sees those controls.
- A banned person's next request has no data access, and Unban restores a pre-existing pause.
- Deleting someone leaves their plans in place, and the history keeps who acted and when without keeping the address.
