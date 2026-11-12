# S-410 hosted rollout — what was set, and what was seen

Phase 6, by hand, per [`docs/runbooks/hosted-auth-settings.md`](../../../docs/runbooks/hosted-auth-settings.md). Never `supabase config push`. The Management API calls used a personal access token scoped to this one project with **Auth Config** read-write only and a short expiry. It was read from a file outside the repo and never printed. Nothing here names a real person: every throwaway mailbox is a developer's own address, and its user was deleted afterwards.

## Before merge (2026-11-11)

### 6.1 Settings and templates

**Found, read-only, before any write:**

- GoTrue v2.197.0 (local runs v2.196.0).
- Sign-up closed, `mailer_autoconfirm` `true`, CAPTCHA off, `site_url` slash-free, SMTP unchanged; S-401's three password values unchanged.
- The recovery template was S-402's text. It differed from the repo only by this slice's "1 hour" → "24 hours".
- The invite subject and template were Supabase's defaults, and the default template uses `{{ .ConfirmationURL }}`.

**Drift since the 2026-10-20 read-back.** Nothing in the repo records these changes, and the cause is unknown. The 2026-10-22 trailing slash on `site_url` was the first such event.

| Field                                            | 2026-10-20                             | Found                                                                    | Now                                      |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| `smtp_max_frequency`                             | 300                                    | **1**                                                                    | 300                                      |
| `mailer_notifications_password_changed_enabled`  | `true`                                 | **`false`**                                                              | `true`                                   |
| `mailer_subjects_password_changed_notification`  | "Your IB Planner password was changed" | Supabase's default                                                       | "Your IB Planner password was changed"   |
| `rate_limit_email_sent`                          | 30                                     | 25                                                                       | 30                                       |
| `uri_allow_list`                                 | the two hosts                          | also `https://*.ib-timetable-planner.dev/**` and `http://localhost:4321/**` | left as found: nothing sends a `redirectTo` yet |

The developer chose to restore the S-402 values in the same write.

**Set:**

1. One PATCH (HTTP 200): `mailer_otp_exp` 86400, `mailer_otp_length` 10, `smtp_max_frequency` 300, `rate_limit_email_sent` 30.
2. The runbook's template sync (HTTP 200): the recovery, invite and password-changed subjects and templates, with the notification on.

The fields changed were saved beforehand to the session scratchpad, for a rollback.

**Read back:** `mailer_otp_exp` 86400, `mailer_otp_length` 10, `smtp_max_frequency` 300, `rate_limit_email_sent` 30, the notification on, the three "IB Planner" subjects. "recovery template in sync", "invite template in sync" and "notification template in sync": each diff was clean.

Until the merge deploys, a reset email promises 24 hours while the deployed `/auth/forgot` notice still says 1 hour. The link outlives the promise, which is the safe direction.

### 6.3 Throwaway invite

- **Sent** at 20:06:39 UTC with `inviteUserByEmail` from Node tooling, never the Worker. The secret key was made for this rollout and read from a file outside the repo. The recipient was a developer's Gmail plus-address that had no hosted account.
- **Link:** `https://ib-timetable-planner.dev/auth/confirm?token_hash=<56 hex>&type=invite`, with one slash after the host.
- **Subject and sender:** "You're invited to IB Planner", from IB Planner <team@ib-timetable-planner.dev>. The body says 24 hours.
- **Authentication:** SPF, DKIM and DMARC all pass.
- **Placement: Gmail's Promotions tab**, not Primary and not Spam. This is recorded in [`email-delivery.md`](../../../docs/runbooks/email-delivery.md). For the school, the placement that counts is the M365 done-line (6.5).
- **Before deletion** the user was still unconfirmed and had never signed in. Nothing spent the link while it sat in Gmail, Google's own link handling included.
- **Deleted** (it held no role). The link then answered `403 otp_expired`.

**Merge.** PR #177 was opened at 20:19 UTC. Its first CI run was stranded queued by a GitHub Actions major outage: githubstatus showed a critical incident, and the run could not be cancelled. Once Actions was operational again (22:24 UTC), an empty commit started a fresh run, and it passed. Before the merge, a re-check found no production solve queued or running. Squash-merged as `0cb8a4eb` at 22:34 UTC.

## After merge (2026-11-11/12)

### 6.2 Deploy

Run 43112840753 was green end to end. Its `deploy` job ran 22:42:15–22:43:44 UTC: migrations applied, `admin-users` deployed, Docker checked, Worker and container shipped. The deployed `/auth/confirm?…&type=invite` renders "Accept your invitation".

### 6.4 The flow on hosted

The developer drove the hosted Users page as admin; the invitee used an incognito window. The implementing session read the database with the rollout's secret key.

**Migration and backfill.**

- Every Auth user has a directory row, and its `invited_at` and `email_confirmed_at` agree with Auth: 4 of 4, none invited, all confirmed.
- The developer ran `pg_get_triggerdef` for `user_directory_clear_must_change_password` in the SQL editor and reported it correct.
- The flow proved the new trigger independently. The old trigger would have lifted the fence at Continue (probe P3), and the fence held.

**Invite, accept, first password** (a Gmail plus-address, invited as Viewer):

| Moment              | `must_change_password` | `email_confirmed_at` | Role     | Seen                                                                                       |
| ------------------- | ---------------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Invited (06:58:41)  | `true`                 | null                 | `viewer` | "Invited" row with Re-send and Revoke; `invitation_sent` and `role_granted`, both by the admin |
| After Continue      | **`true`**             | 06:59:43             | `viewer` | "Accept your invitation", no signed-in warning, then `/account` with the welcome banner          |
| After its password  | `false`                | 06:59:43             | `viewer` | Landed on `/dashboard`, read-only; the Users page row read Viewer, Active                       |

**Revoke** (a second plus-address): invited at 07:02:39, revoked at 07:03:12. The record is `invitation_revoked`, and the account is gone. Its link, opened afterwards in incognito, was refused with the invite-expired copy.

**Cleanup.** The accepted Viewer was deleted by the session. Afterwards, the directory and Auth agree again (4 of 4).

**One unrelated log entry.** An earlier invitation as Author at 06:53:45 has `invitation_sent` and `role_granted` but no `invitation_revoked`. The developer had picked the wrong role and deleted that user in the Supabase dashboard. A dashboard delete bypasses the function, so it leaves no revoke record.
