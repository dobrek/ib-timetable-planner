<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Job-completion email (S-310)

- **Plan**: context/changes/job-completion-email/plan.md
- **Scope**: Phases 1–6 of 6 (all completed phases; 6.3/6.4 are post-merge by design)
- **Date**: 2026-11-19
- **Verdict**: NEEDS ATTENTION (all 7 findings fixed in triage, 2026-11-19)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

**Automated gates**, run 2026-11-19 against the local stack, which this worktree started:

- `pnpm check`: 0 errors.
- `pnpm lint` and `pnpm steiger`: clean.
- `pnpm test`: 278 files, 2947 tests, all passed. A first run, made while the integration lane was also running, failed `bench/campaign/main.test.ts` under load. That file is untouched by this branch, and it passed both alone and in a full re-run.
- `pnpm build`: passed. `dist/server/wrangler.json` carries `triggers.crons ["* * * * *"]` and `vars.APP_ORIGIN`, and `[job-email]` is in `dist/server/entry.mjs`.
- Prettier on the docs: clean.

**Integration suites:**

- The six targeted suites (notifier credential, solver credential, job attribution, role matrix, generation enqueue, job email): 610 tests passed, none skipped.
- The full lane with `--maxWorkers=2`: 50 files and 932 tests passed. The 2 skipped files are the solver-gated suites; no local solver was running.

**Manual 1.9**, the grant posture read live:

- `job_notifier`'s column privileges match the suite's lists exactly.
- `error` and `snapshot` are not readable.
- `rolbypassrls` and `rolcanlogin` are both false.
- The only DEFINER function is `private.current_app_role()`.
- There are five `to job_notifier` policies.

**Manual 1.8**: a local notifier user exists.

**Manual 2.5, 4.7, 5.6 and 5.7**: the observations are recorded in their commit messages.

**Manual 6.3 and 6.4**: pending until after merge, as planned.

## Findings

### F1 — A refused dispatch still emails the author

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/model/generation/job-email.ts:79 (with src/_pages/plan-detail/api/generation-job.ts:105-125, 263-266)
- **Detail**:
  - `startGeneration` inserts the row with `email_requested` before it dispatches.
  - When the dispatch is refused (the solver busy at `max_concurrent_jobs`, a 503 from an unconfigured service, or a network error), `markDispatchFailed` writes `status = 'failed'` and `finished_at`.
  - The decision table sends `failed`, so about a minute later the author gets "generation failed" for an error they already saw on screen. Each retry costs another email from Resend's shared 100/day quota.
  - This is the "they were watching" case that `stopped_by_requester` already skips, but the plan's table never considered it.
  - The guard stops the editor's session from clearing `email_requested`, so a fix has to live in the notifier's decision.
  - `failed` with `started_at` null identifies this case exactly. The solver writes `failed` only from `running` (its `status=eq.running` filter), and the reclaim writes `interrupted`, not `failed`.
- **Fix A ⭐ Recommended**: Skip a `failed` job that never started, under a new outcome `dispatch_refused`.
  - Add a row to `decideJobPhase` after the self-stop row.
  - Add the outcome to the check constraint in `20261119134333_job_completion_email.sql`, edited in place: it is not merged, so hosted has never applied it.
  - Update the unit table tests and add a sweep case.
  - Strength: matches the existing "you already know" skip, and saves quota on retries. The predicate is exact (only the Worker writes `failed` before `started_at`).
  - Tradeoff: one more outcome value, a schema touch (needs `pnpm exec supabase db reset` locally), and plan, runbook and test updates.
  - Confidence: HIGH. The solver's terminal write filters `status=eq.running`, and reclaim writes `interrupted`.
  - Blind spot: none significant. A future path that writes `failed` before `started_at` for a walked-away author would also be skipped.
- **Fix B**: Accept it and document it: one redundant email per refused attempt.
  - Strength: no code or schema change.
  - Tradeoff: noisy emails and quota spent on a failure the author saw.
  - Confidence: HIGH that it works as described.
  - Blind spot: how often a busy solver refuses in production (single instance, 20–38-minute solves).
- **Decision**: FIXED (Fix A)
  - The new decision row and the constraint value are in place, along with the unit rows (4a–c) and a sweep case.
  - A deliberate break turned the sweep case red.
  - The runbook table and the plan are updated.
  - The local DB was reset: re-run `assign-role.mjs` and `provision-notifier-user.mjs`.

### F2 — A claim is stamped with the run's start time, not the time of the claim

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/api/job-email-sweep.ts:250
- **Detail**:
  - `claim` writes `email_claimed_at: new Date(nowMs)`, where `nowMs` is the cron's `scheduledTime`. The expiry cutoff is derived from the same `nowMs`.
  - Rows are handled one at a time, up to 50. A hanging Resend times out at 10 s per row as `failed`, not `stop-tick`, so a run can last more than 8 minutes.
  - A row that run N claims 6 minutes in carries a timestamp already older than `CLAIM_TTL_MS`. A run that starts 6 minutes after N treats that claim as expired while N is still sending, and sends too.
  - In production, Resend's `Idempotency-Key` absorbs the duplicate while the body is unchanged. Mailpit has no such guard.
  - The comment at :65 ("Longer than any send") states the wrong invariant. The claim has to outlast the time from claim to stamp, which only holds if the claim records when it was taken.
- **Fix**: Take and judge claims by the live clock (`Date.now()`, which advances across I/O in Workers): both the claim's value and the cutoffs in `claim` and `stamp`. Keep `nowMs` for decisions and the `emailed_at` stamp, and reword the `CLAIM_TTL_MS` comment. The sweep suite already passes `nowMs: Date.now()`, so the concurrent-sweeps case is unaffected.
- **Decision**: FIXED
  - `claim` dates its claim with `Date.now()`, and both cutoffs go through one `unclaimedAt` helper.
  - `CLAIM_TTL_MS` and the `nowMs` docs state the right invariant.
  - The sweep suite is green, 10/10.

### F3 — Workers Logs cannot say why a run stopped or a send failed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/entities/timetable/api/job-email-sweep.ts:219-222; src/job-email-cron.ts:93
- **Detail**:
  - `SendOutcome` carries the stop reason (`quota`, `rate-limited`, `credential`) and the failure's `status` and `name`, but `send` discards them, and the report holds counts only.
  - A revoked key, a spent quota and a rate limit all read as `deferred=N`. A permanent 4xx such as a 422 reads as `failed=1`, retried every 5 minutes for 24 h (about 288 calls), with nothing in the logs naming it.
  - Phase 6's runbook intent said a credential stop "logs it". The runbook now honestly says "logs nothing more than its counts" (`docs/runbooks/job-email.md:131-134`), so the first real production failure would be undiagnosable from Workers Logs.
  - None of these values is PII.
- **Fix**: Add the stop reason and each failure's `status/name` (never an address or a body) to `JobEmailSweepReport`, and print them on the counts line, e.g. `deferred=3 (credential)` and `failed=1 (422 validation_error)`. Update the runbook's log table and the cron test.
- **Decision**: FIXED
  - The report gains `stoppedBy` and `failures`, typed `SendStopReason` and `SendFailure`, which are derived from `SendOutcome` and exported through `shared/api`.
  - The cron line appends the distinct reasons.
  - Tests: a cron unit case, and a sweep case with a stub transport that also asserts no `@` reaches the report.
  - The runbook's log section and its revoked-key paragraph are updated.

### F4 — Small departures from the plan that no commit records

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/entities/timetable/api/job-email-config.ts:41, 63-90; src/shared/api/mail/resend-transport.ts:79; src/entities/timetable/model/generation/job-email.ts:1, 81
- **Detail**: Three departures, all harmless and tested, appear in no commit message:
  - `readJobEmailConfig` returns `{ ok: false; problems }`, not the planned `missing`. It also parses `APP_ORIGIN`, which must be http(s) and is reduced to its origin, where the plan said "presence only".
  - Every 429 whose name is not a quota name maps to `stop-tick(rate-limited)`, not only `rate_limit_exceeded`.
  - The decision uses `isActiveJobStatus` rather than `isTerminalJobStatus`, its exact inverse.

  The departures the commits do record are: `isLoopbackHost` in `shared/config` (steiger's shared/lib cap); `MailTransport` as a `type`; the counts wording; `chooseMailTransport`; the skip honouring a live claim; and `job-email-availability.ts` as its own file.
- **Fix**: List the three in the PR description, or in a dated addendum to the plan, so the plan stays the source of truth for the archive.
- **Decision**: FIXED. `plan.md` gained "Implementation Addenda (2026-11-19)", listing the three departures and the review fixes.

### F5 — A halted email says "the best board was kept" but links to the source plan when the proposal is gone

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/model/generation/job-email-content.ts:53-54, 113-114
- **Detail**:
  - For a `stopped` or `interrupted` job with a checkpoint whose `proposal_plan_id` has since become null (the proposal plan was deleted before the email went out), `board` is true, so the copy reads "The best board found so far was kept."
  - The link, however, falls back to `plan_id`, the source plan, which does not hold that board.
  - Rare, but the copy is untrue in that case.
- **Fix**: Treat a board as present only when `proposalPlanId` is non-null, i.e. fold the null check into `board`. Add one content test.
- **Decision**: FIXED
  - `hasBoard` now requires the proposal plan to exist.
  - A new content test covers an orphaned checkpoint ("Nothing was kept", no counts line, link to the plan).
  - The content suite is green, 24/24.

### F6 — The notifier can read proposal plan names that the sweep never uses

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261119134333_job_completion_email.sql:169; src/test/job-notifier-credential.integration.test.ts:389
- **Detail**:
  - The plans policy admits `j.plan_id = plans.id or j.proposal_plan_id = plans.id`, as the plan specified.
  - The sweep reads only `plan_id`'s name (`job-email-sweep.ts:232`, `contentFacts`), and the link needs only the id, which comes from the job row.
  - The extra grant exposes no student data, but it is broader than the notifier's need.
  - The migration is unmerged, so narrowing it costs nothing now; after merge it would take a new migration with `alter policy`.
- **Fix**: Narrow the policy to `j.plan_id = plans.id` in the unmerged migration, and update the credential suite's pinned predicate and its "sees the proposal plan" assertion.
- **Decision**: FIXED
  - The policy and its header line now name the source plan only.
  - The credential suite pins the new predicate and asserts that the proposal plan is unreadable.
  - The DB was reset, and the live `pg_policies` qual was confirmed.
  - The credential, sweep and role-matrix suites are green, 576 tests.

### F7 — The idempotency comment claims more than holds in rare paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/model/generation/job-email.ts:38-47; src/entities/timetable/api/job-email-sweep.ts:223
- **Detail**: Three narrow paths:
  - **Event moves:** `JOB_EMAIL_LOOKBACK_MS`'s comment says every retry falls inside the first attempt's key window. That holds only while the event instant stays put. A stalled email's event is `heartbeat_at`; if its send succeeded but the stamp was lost and the job then turns terminal, the event moves to `finished_at`. A retry can then fall outside Resend's 24 h window, and the changed body is stamped `sent` (via 409 `invalid_idempotent_request`) rather than `sent_stalled`.
  - **Stamp throws:** a stamp that throws after a successful send aborts the whole run (`sweep failed`) and leaves the row to be re-sent once the claim expires. Resend replays it; Mailpit duplicates it.
  - **Risk:** all of these need lost writes, so the risk is negligible.
- **Fix**: Reword the comment to name the stall-then-terminal exception and the Mailpit duplicate, so the guarantee is not overstated.
- **Decision**: FIXED. The `JOB_EMAIL_LOOKBACK_MS` comment now states the guarantee as holding "while the event stays put", and names the two gaps: the moving event and Mailpit. Comment only.
