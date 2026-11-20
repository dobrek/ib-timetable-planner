# S-310 hosted rollout — what was set, and what was seen

Phase 6, by hand, after merge, per [`docs/runbooks/job-email.md`](../../../docs/runbooks/job-email.md). Values and observations only: no secrets, no passwords, no keys, and no real names.

**Status: done (2026-11-20).** The job email is live on hosted: the cron runs every minute, and the Generate dialog offers the checkbox.

**Who saw what.** The developer did every step by hand and confirmed the whole rollout done. The closing session held no hosted database credential, so it checked only what it could reach: GitHub, the Worker's secret names, and Workers Logs. Each step below says which of the two it rests on. Where the developer's confirmation is the record, the details (ids, times) were not written down.

## Merge and deploy

- **PR:** [#181](https://github.com/dobrek/ib-timetable-planner/pull/181), merged 2026-11-20 at 20:55:56 UTC. _Checked by the session._
- **Commits and CI run:** rebase-merged as ten commits, ending at `45037216`. CI / CD run 44815771358 on that commit was green end to end, `deploy` included: migration applied, `admin-users` deployed, Worker shipped with `triggers.crons`. _Checked by the session._
- **Production solves running at merge:** not recorded. The developer was told the rule before merging (README § Deployment), and nothing was reported stopped.

## The hosted check

1. **Migration landed.** `job_notifier`'s grants read live with `has_column_privilege` match `src/test/job-notifier-credential.integration.test.ts`'s lists:
   - _Developer-confirmed._ The query given for this step lists each table's readable and writable columns for the role, and its `rolcanlogin` and `rolbypassrls`. Run against the local stack, it returns exactly the credential suite's lists (18 readable job columns with no `error` or `snapshot`, the three writable markers, `plans (id, name)`, `user_directory (email, must_change_password, user_id)`, `user_roles (deactivated_at, user_id)`) and `false, false`.
   - Step 5's counts line is independent evidence: the sweep read the due set as the role, which needs the role, its grants and its policy.
2. **Hosted notifier provisioned** (`scripts/provision-notifier-user.mjs`, hosted URL and secret key from the shell):
   - _Developer-confirmed,_ by the runbook's block, which reads the secret key into the shell and unsets it after the script.
   - Step 5's counts line shows the sign-in works: a refused password grant logs `sign-in failed` instead. The Worker sets no `NOTIFIER_MACHINE_EMAIL`, so the cron signs in as the default address, `notifier@ib-timetable-planner.dev`.
3. **Resend key created** (`Sending access`, `ib-timetable-planner.dev` only, named `job-email-notifier`):
   - _Developer-confirmed._ Step 7's email is the evidence that it sends.
4. **Worker secrets set** (`NOTIFIER_MACHINE_PASSWORD`, `RESEND_API_KEY`; `wrangler secret list`, names only):
   - _Checked by the session_ (2026-11-20, about 22:05 UTC). `wrangler secret list` names seven secrets: `NOTIFIER_MACHINE_PASSWORD`, `RESEND_API_KEY`, `SOLVER_MACHINE_PASSWORD`, `SUPABASE_KEY`, `SUPABASE_URL`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`. No `CALIBRATION_*` override is set.
5. **Cron running.** A `[job-email] sent=… skipped=… …` counts line, not `disabled`, in Workers Logs:
   - _Checked by the session_ with `wrangler tail`. The `* * * * *` run of 2026-11-20 at 22:09:05 UTC ended `Ok` and logged `[job-email] sent=0 skipped=0 waiting=0 deferred=0 failed=0`. So the configuration is complete, the notifier signed in, and the sweep read the due set, which was empty by then.
6. **One opted-in Generate on hosted,** as an account whose address is a developer's Gmail:
   - _Developer-confirmed._ The job's id and times were not recorded.
7. **One email in the Gmail Inbox** (not Spam); SPF and DKIM pass in "Show original"; its one link opens the plan on `https://ib-timetable-planner.dev`:
   - _Developer-confirmed._
8. **The row reads `email_outcome = 'sent'`:**
   - _Developer-confirmed._

Plan rows 6.3 and 6.4 are ticked on this record.
