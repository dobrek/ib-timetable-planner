# S-310 hosted rollout — what was set, and what was seen

Phase 6, by hand, after merge, per [`docs/runbooks/job-email.md`](../../../docs/runbooks/job-email.md). Record values and observations only: no secrets, no passwords, no keys, and no real names (a throwaway or developer-owned Gmail address is named only as "a developer's Gmail").

**Status: pending.** Nothing below has been done yet. Merge only while no production solve is running (README § Deployment). Until steps 2–4 are done, the deployed cron logs `[job-email] disabled: …` once per isolate and the Generate dialog offers no checkbox.

## Merge and deploy

- PR: _pending_
- Squash-merge commit and CI run: _pending_
- Production solves running at merge: _pending (must be none)_

## The hosted check

1. **Migration landed.** `job_notifier`'s grants read live with `has_column_privilege` / `has_table_privilege` match `src/test/job-notifier-credential.integration.test.ts`'s lists:
   - _pending_
2. **Hosted notifier provisioned** (`scripts/provision-notifier-user.mjs`, hosted URL and secret key from the shell):
   - _pending_
3. **Resend key created** (`Sending access`, `ib-timetable-planner.dev` only, named `job-email-notifier`):
   - _pending_
4. **Worker secrets set** (`NOTIFIER_MACHINE_PASSWORD`, `RESEND_API_KEY`; `wrangler secret list`, names only):
   - _pending_
5. **Cron running.** A `[job-email] sent=… skipped=… …` counts line, not `disabled`, in Workers Logs:
   - _pending_
6. **One opted-in Generate on hosted,** as an account whose address is a developer's Gmail:
   - _pending_
7. **One email in the Gmail Inbox** (not Spam); SPF and DKIM pass in "Show original"; its one link opens the plan on `https://ib-timetable-planner.dev`:
   - _pending_
8. **The row reads `email_outcome = 'sent'`:**
   - _pending_

When all eight are recorded, tick 6.3 and 6.4 in `plan.md`'s Progress and archive the change.
