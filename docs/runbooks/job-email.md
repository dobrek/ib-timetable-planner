# Job-email runbook

How the job-completion email works (S-310), what the Worker holds for it, how to provision, rotate
and switch it off, and how to prove it on hosted. The sender, the domain and the shared quota are
[`email-delivery.md`](email-delivery.md)'s; the token hook it signs in through is
[`solver-credential.md`](solver-credential.md)'s.

## What it does

An author who ticks **Email me when it finishes** in the Generate dialog gets one email when that job
ends, stalls, or is stopped by someone else. It works with no browser open.

- **A Worker Cron Trigger** (`wrangler.jsonc` `triggers.crons`, `* * * * *`, UTC) runs
  `src/job-email-cron.ts` once a minute.
- **It signs in as the `job_notifier` machine user** with the publishable key and a password: a
  password grant, never a secret key. The Custom Access Token Hook maps the user's
  `app_metadata.machine_role = job_notifier` to the Postgres role of the same name. The hook is
  already enabled on hosted (it serves the solver); `20261119134333_job_completion_email.sql`
  re-creates its body to map both machine roles.
- **It sweeps** `generation_jobs` for opted-in jobs whose email is still due
  (`email_requested and emailed_at is null`), decides each one, claims it, sends, and stamps
  `emailed_at` and `email_outcome`.
- **It sends through Resend's HTTP API** with its own sending-only key and an
  `Idempotency-Key: job-email/<job id>`. It is never sent through GoTrue, whose SMTP key stays with
  Supabase.

The email names the plan, the outcome, how long it ran, the policy, and (when a board exists) how
many courses could not be fully placed. It has exactly one link, to the proposal or the plan, and no
`error` text, student data, images, tracking, forms or scripts.

### Who gets one, and what the row records

| `email_outcome`        | Meaning                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `sent`                 | Emailed: the job succeeded, failed, was interrupted, or was stopped by someone else |
| `sent_stalled`         | Emailed: the heartbeat went quiet for over 5 minutes (one email per job, final)     |
| `stopped_by_requester` | Not emailed: the requester pressed Stop themselves                                  |
| `no_recipient`         | Not emailed: no requester (pre-S-407, or deleted), or no directory row              |
| `recipient_fenced`     | Not emailed: the requester is pending, deactivated, or holds no role                |
| `expired`              | Not emailed: the event was more than 24 hours old when the sweep saw it             |

A job that never opted in is never touched. `notified_at` is the plans hub's badge marker and is not
the emailer's: the sweep neither reads nor writes it.

```sql
-- What happened to recent job emails (run as postgres, or through the dashboard's SQL editor)
select id, status, email_requested, email_claimed_at, emailed_at, email_outcome
  from public.generation_jobs
 where email_requested
 order by created_at desc
 limit 20;
```

## What the Worker holds

| Name                           | Kind                      | Value                                                                  |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `NOTIFIER_MACHINE_PASSWORD`    | Worker secret             | The `job_notifier` machine user's password                             |
| `RESEND_API_KEY`               | Worker secret             | A Resend `sending_access` key restricted to `ib-timetable-planner.dev` |
| `APP_ORIGIN`                   | `wrangler.jsonc` `vars`   | `https://ib-timetable-planner.dev`, the origin every link is built on  |
| `SUPABASE_URL`, `SUPABASE_KEY` | Worker secrets (existing) | The project URL and the publishable key                                |
| `NOTIFIER_MACHINE_EMAIL`       | optional                  | Defaults to `notifier@ib-timetable-planner.dev`                        |

**No secret key.** The Worker still holds none (CLAUDE.md). What the notifier's session can reach is
decided by its role's column grants and policies, pinned by
`src/test/job-notifier-credential.integration.test.ts`:

- **It reads** the job facts and email markers on opted-in jobs (never `error` or `snapshot`). It
  also reads a requester's address and fences, and a plan's name, only while a job of theirs still
  has an email due.
- **It writes** only `email_claimed_at`, `emailed_at` and `email_outcome`, and only on an opted-in job
  whose email is unsettled.

A leaked notifier password reads a handful of addresses, not the staff directory, and can send
nothing by itself: the Resend key is a separate secret.

**Until both secrets are set,** the cron logs `[job-email] disabled: missing …` once per isolate and
does nothing, and the Generate dialog offers no checkbox. That is the state the first deploy lands
in: CI applies the migration, then deploys the Worker with its cron, and the steps below are by hand.

## Provisioning and rotation

Rotation is the same operation as creation. Run it against hosted with the project URL and the
**secret** key from your shell, never from a file in the repo:

```bash
read -rs NOTIFIER_MACHINE_PASSWORD && export NOTIFIER_MACHINE_PASSWORD   # 15+ characters; no '#', quotes or spaces
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY   # the hosted sb_secret_… key
SUPABASE_URL=https://<project-ref>.supabase.co node scripts/provision-notifier-user.mjs
unset SUPABASE_SERVICE_ROLE_KEY
printf %s "$NOTIFIER_MACHINE_PASSWORD" | pnpm exec wrangler secret put NOTIFIER_MACHINE_PASSWORD
unset NOTIFIER_MACHINE_PASSWORD
```

A session the cron already holds keeps working until its token expires. A new sign-in between the two
writes fails, is logged (`[job-email] sign-in failed (invalid_credentials)`), and that run is skipped;
the first run after the secret lands signs in with the new password. A rotation can therefore delay
emails by a minute or two and loses none, because a due job stays due.

Locally, the same script runs with the local stack's keys (README § Getting Started, step 7).

### The Resend key

Create it in the Resend dashboard (**API Keys → Create**):

- **Permission:** `Sending access`.
- **Domain:** `ib-timetable-planner.dev` only.
- **Name:** `job-email-notifier`, so its logs read apart from the SMTP key's.

It is **separate from the SMTP key** that only Supabase holds: each can be revoked alone. Then:

```bash
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret list   # names only
```

## The kill switch

```bash
pnpm exec wrangler secret delete RESEND_API_KEY
```

It is the one **quiet** off switch:

- the cron logs `[job-email] disabled: missing RESEND_API_KEY or MAILPIT_URL` and does nothing;
- the Generate dialog stops offering the checkbox, because the route and the cron share one config
  reader;
- the schema stays as it is. Jobs opted in before the switch stay due, and are sent if the key returns
  within 24 hours of their event, or expire after that.

**Revoking the key in Resend is not equivalent.** The cron stays configured and the checkbox stays
visible. Each run claims the first due job, gets a 401 or 403, logs nothing more than its counts
(`deferred=…`), and stops the run (`stop-tick(credential)`), until the jobs expire after 24 hours.
Delete the secret as well.

## The shared quota

Resend Free's **100 emails per UTC day is shared** by password resets, password-changed
notifications, invitations, and job emails ([`email-delivery.md`](email-delivery.md) § Caps). There is
no app-side cap for job emails; expected volume is a handful a day (`max_instances: 1`, 20–38-minute
solves). A `429 daily_quota_exceeded` (or `monthly_quota_exceeded`, or `rate_limit_exceeded`) ends the
cron's run with the job still due, and it goes out on a later run, within its 24-hour window. The
fallback is Resend Pro.

## What Workers Logs show

```bash
pnpm exec wrangler tail --format pretty   # or the dashboard: Workers → ib-timetable-planner → Logs
```

| Line                                                         | Meaning                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `[job-email] sent=… skipped=… waiting=… deferred=… failed=…` | One run, counts only. Every minute while configured.                                                   |
| `[job-email] disabled: missing …`                            | Not configured. Once per isolate, not per run.                                                         |
| `[job-email] sign-in failed (<code>); skipping this run`     | The password grant was refused: a rotation in progress, a wrong password, or `over_request_rate_limit` |
| `[job-email] sweep failed: …`                                | A database read or write failed. The next run signs in afresh.                                         |

No line carries an address or a plan name.

`waiting` counts jobs still running, or held by another run's claim. `deferred` counts jobs not
reached because Resend refused every send for now. `failed` counts sends that failed; each is retried
once its 5-minute claim expires.

## Things never to do

- **Never enable Supabase Auth CAPTCHA.** It also covers password grants: the notifier and the solver
  would both stop signing in, and its only bypass is the secret key the Worker must not hold.
- **Never put `RESEND_API_KEY` in an `.envs` profile.** Locally and in CI the email goes to Mailpit
  (`MAILPIT_URL`); setting both is refused as a configuration error.
- **Never widen the token hook's allowlist without a reviewed migration.** It maps exactly
  `solver_job_writer` and `job_notifier`.
- **The password grant is rate-limited with every other sign-in.** It counts against GoTrue's
  `token_refresh` bucket (150 per 5 minutes per IP), which every human sign-in and refresh leaving the
  same Cloudflare egress IP shares. The cron reuses its session and signs in about once an hour per
  isolate; a 429 only skips a run.

## The hosted check

Recorded in `context/changes/job-completion-email/hosted-check.md` (archived with the change), after
merge, with no secrets and no real names:

1. Confirm the migration landed: `job_notifier`'s grants read live with `has_column_privilege`.
2. Provision the hosted notifier (above).
3. Create the Resend key (above).
4. Set both Worker secrets.
5. See a `[job-email]` counts line (not `disabled`) in Workers Logs.
6. Run one opted-in Generate on hosted, as an account whose address is a Gmail inbox.
7. See one email in the Gmail **Inbox** (not Spam), with SPF and DKIM passing in "Show original", and
   its link opening the plan on `https://ib-timetable-planner.dev`.
8. Confirm the row reads `email_outcome = 'sent'`.

Merge only while no production solve is running (README § Deployment).
