# Job-completion email (S-310) Implementation Plan

## Overview

An author who ticks **"Email me when it finishes"** in the Generate dialog gets one email when that job ends, stalls, or is stopped by someone else. It works with no browser tab open. A Worker Cron Trigger sweeps once a minute and signs in as a new, narrow `job_notifier` machine role. It sends through Resend's HTTP API in production and Mailpit's HTTP send API locally and in CI. The email carries no student data and no `error` text, and exactly one link.

Roadmap slice S-310 (issue [#107](https://github.com/dobrek/ib-timetable-planner/issues/107)), FR-309 of the archived CP-SAT PRD, and the PRD's §NFG (no student data). Prerequisites S-402 (sender, domain) and S-407 (`generation_jobs.requested_by`) are done.

## Current State Analysis

- **Nothing notices a finished job without a browser.** The solver's terminal write (`status` + `finished_at`, `services/solver/src/cpsat_service/supabase.py:236-257`) needs no browser. Delivery, reclaim of a wedged row, and `notified_at` all run inside an editor's request (`src/_pages/plan-detail/api/generation-delivery.ts:70-77, 100-139`).
- **The Worker has no identity outside a request.** `src/worker.ts:26` exports `{ fetch: handle }` only. `wrangler.jsonc` has no `triggers`. The Worker's Supabase clients are cookie-bound or anonymous (`src/shared/api/supabase.ts:7-53`), and `anon` is revoked on `generation_jobs`.
- **The token hook maps exactly one machine role.** `public.custom_access_token_hook` (`supabase/migrations/20260810200934_custom_access_token_hook.sql:37-51`, the only and therefore live definition) passes the event through unless `machine_role` is exactly `solver_job_writer`.
- **`notified_at` is the badge's marker, not a notification channel.** Its only writer is `markNotified`, on an editor's proposal visit (`generation-delivery.ts:100-139`). Its only reader is the plans hub (`src/_pages/plans-list/api/generation-status.ts:93-99`). Several comments still promise that S-310's emailer will be a "second writer" (`generation-delivery.ts:115`, `src/_pages/plans-list/model/generation-toasts.ts:19-20`, `src/test/generation-jobs.integration.test.ts:22`, `supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql:47-57`). This plan retires that promise: the emailer never touches `notified_at`.
- **The in-app half of FR-309 is done** (S-306 toasts and badges). Only the email is missing.
- **No app code sends mail.** All product mail today is GoTrue → SMTP → Resend, with the sending-only SMTP key held only by Supabase (`docs/runbooks/email-delivery.md:22-23`). Resend Free's 100/day is shared with resets and invitations (`email-delivery.md:71-80`).
- **The research is the baseline:** `context/changes/job-completion-email/research.md` (T1 design, challenges C1–C15).

## Desired End State

- When the notifier is configured, the Generate dialog shows a ticked **"Email me when it finishes"** checkbox on every open. When it is not (before the hosted secrets exist, or after the kill switch), the checkbox is absent and the job is written with `email_requested = false`, so the UI never promises an email that nothing will send. The choice is written once onto the job row (`generation_jobs.email_requested`), and nobody can change it afterwards.
- Within about a minute of an opted-in job reaching any of these states, its requester gets one email:
  - `succeeded`, `failed` or `interrupted`;
  - `stopped` by someone other than themselves;
  - **stalled**, meaning the heartbeat is past the 5-minute grace.
- The email names the plan, the outcome, how long it ran, the policy, and (when a board exists) how many course groups could not be placed. It has one link to the plan to open, and nothing else.
- No email is sent when:
  - the requester stopped the job themselves;
  - the dispatch was refused, so the author saw the error at Generate (impl review F1);
  - the requester is gone, pending, deactivated, or has no role;
  - the event is more than 24 h old.
- The skip is recorded on the row (`email_outcome`), and no job is ever emailed twice.
- The notifier reads, through its own machine credential, only the columns and rows it needs. Specifically:
  - it can never read `error` or `snapshot`;
  - it sees a user's directory or role row only while that user has an opted-in job whose email is still unsettled.
- With the notifier unconfigured (no password, no transport, no origin), the cron is a quiet no-op.
- **Verify:** `pnpm test`, `pnpm test:integration` (the credential and sweep suites), `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm build` (with `triggers.crons` present in `dist/server/wrangler.json`), a local cron smoke through Mailpit, and one real hosted email received in Gmail.

### Key Discoveries:

- **The adapter keeps a `scheduled` export.** `@astrojs/cloudflare` 14.3.1 does not wrap a project-owned `main`. The Vite plugin re-exports the default object as is, and `getOutputConfig` spreads the input config, so `triggers` reaches `dist/server/wrangler.json` (verified in `node_modules`, 2026-11-16).
- **`ExportedHandler` in `src/cloudflare-env.d.ts:81-83` models only `fetch`.** `{ fetch, scheduled } satisfies ExportedHandler<Env>` fails with an excess-property error until a hand-written `scheduled?` member and `ScheduledController` are added. Never run `wrangler types`.
- **Local cron trigger:** under `pnpm preview` (and `astro dev`), `curl 'http://localhost:4321/cdn-cgi/local/scheduled?cron=*+*+*+*+*'` fires `scheduled`. Miniflare answers it before Astro's middleware. Nothing fires it automatically.
- **The password grant counts against GoTrue's `token_refresh` limit** (150 per 5 min per IP, hosted and local `supabase/config.toml:194`), not `sign_in_sign_ups`. That limit is shared with every sign-in and refresh the Worker makes from the same egress IP.
- **Resend:**
  - `POST https://api.resend.com/emails` needs a `User-Agent` (403 without one).
  - `Idempotency-Key` is 1–256 chars and lasts 24 h. A failed request is not stored.
  - 409 `concurrent_idempotent_requests` means the key is in flight. 409 `invalid_idempotent_request` means the same key was sent earlier with a different body, which can only have been a successful send.
  - The three 429s differ by `name`: `daily_quota_exceeded`, `monthly_quota_exceeded`, `rate_limit_exceeded`.
- **Mailpit v1.30.2** (pinned by Supabase CLI 2.117.0) serves `POST /api/v1/send` with no auth here. Its body is `{From:{Email,Name}, To:[{Email}], Subject, Text, HTML}`. Not yet probed live: Phase 4 opens with the probe.
- **The attribution guard** `private.guard_job_attribution()` has exactly one definition: `supabase/migrations/20261106192749_created_by_and_job_ownership.sql:167-216`, trigger `:222-224` (`before insert or update of requested_by, stop_requested_at, stop_requested_by`). It returns early for any `current_user` other than `authenticated`, so `job_notifier` and the solver pass through untouched.
- **Machine principals are already excluded generically from the human model.** `user_directory.is_machine` is derived from *any* `machine_role` (`20261105073614:57-80`). `assign-role.mjs`, `admin-users` and the `user_roles` backfill all key on any `machine_role`.
- **Two exceptions name the solver specifically.** The role matrix's structural queries filter `p.roles <> '{solver_job_writer}'` (`src/test/role-matrix.integration.test.ts:664, 697`). `scripts/provision-solver-user.mjs:25-26` hard-codes the role and email.
- **Pattern to copy for the role:** `20260810200931_solver_job_writer_role.sql` (`create role … nologin`, `grant … to authenticator`, `usage on schema public`, no BYPASSRLS, no default privileges). Column-scoped SELECT comes from `20260812141459_solver_select_column_scope.sql:66-72`. The guard suite is `src/test/solver-credential.integration.test.ts` (role claim, 42501s, exact `heldColumnPrivileges`, `rolbypassrls`/`rolcanlogin`).
- **Launch chain:**
  `GenerateButton.tsx:87-90` `launch({ preset })`
  → `use-generation-job.ts:55,65,99-114`
  → `generation-client.ts:10-19`
  → `generation-actions.ts:22-25` (schema-driven)
  → `generation-job.ts:63-66` `startGenerationInput`
  → `:99-105` / `insertJob :171-210`.
  A `Checkbox` exists in `src/shared/ui` (`index.ts:17`).
- **Where a board lives:** a succeeded job's board is in `result`. A halted (`stopped`/`interrupted`) job keeps one in `checkpoint` iff `checkpoint_stage_index` is non-null (`src/entities/timetable/model/generation/job-delivery.ts:61-71`). Unplaced counts are `GenerationDiagnostics.cohorts[c].unplaced: CourseDeficit[]` (`model/generation/types.ts:60-101`).

## What We're NOT Doing

- **No per-user email preference** (`profiles` column, `/account` toggle). The checkbox is per job, ticked on every open.
- **No changing the choice after launch.** No strip control. The guard freezes `email_requested` and the three marker columns for every signed-in session.
- **No app-side daily cap.** Resend's shared 100/day is an accepted risk. A 429 ends the tick, and the email goes out on a later one.
- **No dedupe against in-app views.** `notified_at` is never read or written by the emailer, and there is no grace period after `finished_at`.
- **No server-side check in the notifier.** The oracle still runs only at an editor's visit. The email says "finished: open it to review", never "ready" or "verified".
- **No reclaim by the notifier.** It is read-mostly. A stalled row stays `running` until an editor's visit reclaims it, as today.
- **No second email** after a stalled email, even if the job later recovers or is reclaimed (one email per job).
- **No `error` text, no student data, no images, tracking, forms or scripts** in any email. No display-name greeting (no `profiles` grant).
- **No Supabase extension** (pg_cron, pg_net, Vault). **No new Edge Function. No secret key** anywhere new. **No second `SECURITY DEFINER`.**
- **No M365 school-inbox check.** The done-line is one hosted email received in Gmail. S-402's and S-410's M365 debts stay open.
- **No E2E spec.** No browser is in the email path, and the checkbox is covered by the dialog's unit test.
- **No migration off `@cloudflare/containers`** (deprecated 2026-11-09): its own issue.

## Implementation Approach

The research's T1, narrowed by this session's decisions:

```
Generate dialog ── "Email me when it finishes" (☑ every open) ──► generation_jobs.email_requested (frozen by the guard)

Cloudflare Cron "* * * * *" ─► src/worker.ts default { fetch, scheduled }
   └─ src/job-email-cron.ts        read env → missing anything? log once per isolate, return
        ├─ machine client          reuse the isolate's session while valid, else ONE password grant (429 → skip tick)
        ├─ select mail transport   RESEND_API_KEY → Resend · else MAILPIT_URL (loopback only) → Mailpit · else none
        └─ sweepJobEmails(client, transport, { origin, nowMs })        src/entities/timetable/api/
             ├─ due jobs           email_requested and emailed_at is null (the query's filter; RLS admits every opted-in row)
             ├─ decideJobPhase     pure: wait | skip(outcome) | needs-recipient(kind)   model/generation/job-email.ts
             ├─ lookups            user_directory, user_roles, plans (only for "needs-recipient") → decideRecipient
             ├─ skip               stamp emailed_at + email_outcome (CAS on emailed_at is null)
             └─ send               claim email_claimed_at (CAS, 5-min expiry) → transport.send(Idempotency-Key job-email/<id>)
                                   → stamp emailed_at + 'sent' | 'sent_stalled'; on failure leave the claim to expire
```

The job row is the only status channel, so a poll with marker columns is the natural shape. A failed send is simply a row that is still due. Nothing is pushed.

**Decision table (pure, `decideJobEmail`), evaluated in this order:**

| Condition                                                                                                       | Result                                   |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Event instant older than 24 h (terminal: `finished_at ?? created_at`; active: `heartbeat_at ?? created_at`)     | skip `expired`                           |
| Active (`queued`/`running`) and not `isStaleActiveJob`                                                          | wait                                     |
| `stop_requested_by` non-null and equal to `requested_by`                                                        | skip `stopped_by_requester`              |
| `failed` with `started_at` null (the dispatch was refused; added by impl review F1, 2026-11-19)                | skip `dispatch_refused`                  |
| `requested_by` null, or no directory row                                                                        | skip `no_recipient`                      |
| `must_change_password`, no `user_roles` row, or `deactivated_at` set                                            | skip `recipient_fenced`                  |
| Active and stale                                                                                                | send `stalled` → outcome `sent_stalled`  |
| `succeeded` / `failed` / `interrupted` / `stopped`                                                              | send that kind → outcome `sent`          |

A viewer requester (demoted mid-solve) is not fenced and is emailed. The copy reads "open the plan to review it", which is true for a viewer too.

## Critical Implementation Details

- **The email body must be a pure function of the row.** Resend answers 409 `invalid_idempotent_request` when the same key arrives with a different body, so retries must send identical bytes. Use only row timestamps (duration is `finished_at − started_at`, or `heartbeat_at − started_at` when stalled), never `now`. If a plan is renamed between attempts, a 409 `invalid_idempotent_request` still means an earlier attempt with that key succeeded (Resend stores only successes), so stamp `sent`.
- **The lookback must not exceed Resend's 24 h idempotency window.** A job is due only within 24 h of its event, and every attempt happens after the event, so a retry is always inside the key's window. Keep `JOB_EMAIL_LOOKBACK_MS` ≤ 24 h, and say why next to the constant.
- **Claim before sending, stamp after.** The claim CAS (`email_claimed_at` null or older than 5 min, `emailed_at` null) is what keeps two overlapping ticks, and two parallel test sweeps over Mailpit (which has no idempotency), from sending twice. On transport failure, leave the claim to expire. That is the backoff.
- **Escape the plan name.** It is free text written by authors. Escape it in HTML, and strip CR/LF from the subject. Never put it in a URL.
- **One password grant per tick at most, never retried within a tick.** Treat GoTrue's `over_request_rate_limit` (429) as "skip this tick". The bucket is shared with every human sign-in that leaves the same Cloudflare egress IP.
- **Re-create SQL functions from their live bodies:** the token hook from `20260810200934:37-51`, the guard from `20261106192749:167-216` (lessons.md). `create or replace function` keeps existing grants, but re-state them anyway.
- **The hosted rollout order is fixed by CI.** On merge, `db push` lands the role and hook first, then the Worker deploys with its cron. Until the hand-made steps in Phase 6 are done, the cron must log "disabled" once per isolate and return. It must never throw every minute.

## Phase 1: Database and notifier identity

### Overview

One additive migration gives `generation_jobs` its email columns and creates the `job_notifier` role. The role gets column grants and row-scoped policies, the token hook maps it, and the attribution guard freezes the opt-in. The guard suites are written first and shown red. Test filters and provisioning learn that there is more than one machine role, and the docs and comments that named the old "second writer" plan are corrected in the same phase.

### Changes Required:

#### 1. Notifier credential suite (written first, red)

**File**: `src/test/job-notifier-credential.integration.test.ts` (new)

**Intent**: Pin the notifier's whole access posture before the migration exists, mirroring `solver-credential.integration.test.ts`. Run it red, then turn it green with the migration.

**Contract**: The machine user comes from a new factory, `createSignedInMachineUser(admin, "job_notifier")` (`src/test/factories/`). It is created through the admin API with `app_metadata.machine_role = "job_notifier"` and a unique email per call (so this suite and Phase 4's never collide in parallel), and signed in with the publishable key.

The sweep is global, and Phase 4's suite runs it in parallel with this one. So every unsettled opted-in fixture here is `running` with a fresh heartbeat (the sweep always decides `wait` on it), and every settled fixture is stamped by the service role.

Assertions:
- The decoded `role` claim is `job_notifier`. An unrecognised `machine_role` still yields `authenticated`.
- 42501 on every table outside its grants: courses, students, profiles, access_changes, and the rest.
- The exact `heldColumnPrivileges`:
  - SELECT on `generation_jobs` (`id, plan_id, proposal_plan_id, status, requested_by, stop_requested_by, created_at, started_at, finished_at, heartbeat_at, policy, result, checkpoint, checkpoint_stage_index, email_requested, email_claimed_at, emailed_at, email_outcome`), `plans (id, name)`, `user_directory (user_id, email, must_change_password)`, `user_roles (user_id, deactivated_at)`;
  - UPDATE on `generation_jobs (email_claimed_at, emailed_at, email_outcome)` only.
- Selecting `error` or `snapshot` is 42501.
- Row scope:
  - it sees opted-in jobs, settled ones included (see the SELECT policy note in §3), but never a job that never opted in;
  - a settle write (`emailed_at` + `email_outcome` on an unsettled opted-in row) succeeds under the notifier's own session, which pins the new-row check;
  - it sees the directory and role rows of the requester of an opted-in job whose email is still unsettled, but not another user's;
  - it sees that job's source plan only (narrowed from "source and proposal" by impl review F6).
- Writing `status` or `notified_at` is refused. INSERT and DELETE are refused. `rolbypassrls = false`, `rolcanlogin = false`.
- Every `to job_notifier` policy's name and predicate is pinned from `pg_policies`, as the solver suite pins its own (`:144-170`). The role matrix filters machine policies out, so this suite is where they're held.

#### 2. Guard freeze test (written first, red)

**File**: `src/test/job-attribution.integration.test.ts`

**Intent**: Prove that the four email columns belong to launch and to the notifier, never to a person. `email_requested` is fixed at launch. `email_claimed_at`, `emailed_at` and `email_outcome` are always null after a signed-in insert, whatever the insert sent. After insert, no signed-in session (requester, other editor, admin) can change any of the four, while a service-role write still can (the guard judges only `authenticated`). `authenticated` holds table-wide UPDATE on `generation_jobs` (`20260617171048:14-16`), so without this an editor could silence or re-arm someone else's email.

**Contract**: A new case per principal and column. The refusal is SQLSTATE 42501. One insert case sets the three markers and reads them back null.

#### 3. The migration

**File**: `supabase/migrations/<timestamp>_job_completion_email.sql` (new, via `pnpm exec supabase migration new job_completion_email`)

**Intent**: Everything the notifier needs at the database layer, additive and atomic, in the repo's migration style: a header explaining what, why and the deliberately-not-granted list, plus post-conditions in a `do` block.

**Contract**:
- `generation_jobs` gains:
  - `email_requested boolean not null default false`. Existing rows read false, so the first deploy cannot flood. No backfill.
  - `email_claimed_at timestamptz`, `emailed_at timestamptz`, `email_outcome text`.
  - A check constraint keeping `email_outcome` in (`sent`, `sent_stalled`, `no_recipient`, `recipient_fenced`, `stopped_by_requester`, `dispatch_refused` (impl review F1), `expired`), and `(emailed_at is null) = (email_outcome is null)`.
  - A partial index for the due set (`where email_requested and emailed_at is null`).
- Role `job_notifier`, built like `solver_job_writer`: `nologin`, granted to `authenticator`, `usage` on `public`, no BYPASSRLS, no default privileges, no table-wide grant. Column grants exactly as the suite pins them.
- `to job_notifier` policies:
  - `generation_jobs` SELECT `using (email_requested)`. The row predicate cannot also say `emailed_at is null`: PostgREST's UPDATE always carries a RETURNING, and Postgres checks the NEW row against SELECT policies, so every settle write would fail 42501 (measured for the solver, `20260812141459:16-29`). The narrowing lives in the column grants, as it does for the solver, and the header says so;
  - UPDATE `using (email_requested and emailed_at is null)` and `with check (email_requested)`;
  - `plans` / `user_directory` / `user_roles` SELECT whose USING admits only ids referenced by such a job (`plan_id`, `requested_by`; `proposal_plan_id` dropped by impl review F6).
- `public.custom_access_token_hook` re-created from its live body. The allowlist becomes exactly {`solver_job_writer`, `job_notifier`}, and a null or unknown value still passes the event through. Execute is still granted to `supabase_auth_admin` only.
- `private.guard_job_attribution()` re-created from its live body:
  - for `authenticated`, an INSERT forces `email_claimed_at`, `emailed_at` and `email_outcome` to null;
  - for `authenticated`, an UPDATE that changes any of `email_requested`, `email_claimed_at`, `emailed_at` or `email_outcome` raises 42501;
  - the trigger's column list gains all four.
- A header note retires the "S-310 is the second writer of `notified_at`" plan recorded in `20260828093000:47-57` and `20261106192749:38-41`. The emailer has its own columns.
- Post-conditions:
  - the role's attributes;
  - `has_column_privilege` on `error` and `snapshot` false;
  - the `SECURITY DEFINER` set still exactly `private.current_app_role`;
  - the hook's body maps both values.

#### 4. Role-matrix filters

**File**: `src/test/role-matrix.integration.test.ts`, `src/test/role-matrix-expectations.ts`

**Intent**: Stop special-casing the solver. The structural checks exclude every machine role's policies, so a `to job_notifier` policy doesn't read as a human policy.

**Contract**: A single exported `MACHINE_ROLES` constant (`solver_job_writer`, `job_notifier`) replaces the literal `p.roles <> '{solver_job_writer}'` filters at `:664` and `:697` with set containment, `not (p.roles <@ <MACHINE_ROLES>)`, not array inequality. A policy is excluded only when every role it names is a machine role, so a policy naming both a machine role and `authenticated` still reads as human and is checked. `src/test/access-claims.ts:5` already types `machine_role?: string` and needs no change. No human cell changes.

#### 5. Generated types

**File**: `src/shared/api/database.types.ts`

**Intent**: Regenerate after the migration with `pnpm db:types` (fail-safe script). Check the diff shows only the four new columns.

**Contract**: Generator output, committed verbatim.

#### 6. Provisioning

**File**: `scripts/lib/provision-machine-user.mjs` (new), `scripts/provision-solver-user.mjs`, `scripts/provision-notifier-user.mjs` (new)

**Intent**: Move the create-or-rotate logic (including the human-role drop) into a shared helper parameterised by machine role, default email and env-var names. The solver script keeps its exact CLI and env, so CI's calls at `ci.yml:153-156, 246-249` and the README stay valid. The notifier script uses `NOTIFIER_MACHINE_EMAIL` (default `notifier@ib-timetable-planner.dev`) and `NOTIFIER_MACHINE_PASSWORD` (≥ 15 characters, the local Auth floor).

**Contract**: Both scripts stay idempotent. Rotation is the same operation as creation.

#### 7. Comments and CLAUDE.md that name these mechanisms

**File**: `src/_pages/plan-detail/api/generation-delivery.ts:110-138`, `src/_pages/plans-list/model/generation-toasts.ts:19-20`, `src/test/generation-jobs.integration.test.ts:22`, `supabase/config.toml:290-297`, `CLAUDE.md`

**Intent**: A doc that names a mechanism is coupled to it (lessons.md), so these change in the same phase.
- `markNotified`'s docblock drops "S-310's emailer is the intended SECOND writer". `notified_at` stays the badge's marker alone.
- The toasts comment drops "third reader".
- `supabase/config.toml`'s `[auth.hook.custom_access_token]` comment says only the solver's machine user is mapped. It gains the notifier (`job_notifier`, reaching only the job-email columns and rows), and its guard-test pointer gains `job-notifier-credential.integration.test.ts`. Comment only: never `config push`.
- CLAUDE.md's token-hook bullet changes to "the exact values `solver_job_writer` and `job_notifier`".
- CLAUDE.md's "Worker holds no secret key" bullet gains: it signs in as its own narrow machine user (`job_notifier`) for the job-email cron, never with a secret key.
- CLAUDE.md's "Every policy names `to authenticated`" bullet records the machine-role exception: `to solver_job_writer` and `to job_notifier` policies are machine-only. Each is pinned by its role's credential suite, never by the role matrix.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- [x] The notifier credential suite and the guard freeze cases fail before the migration (red recorded in the commit message or PR). The credential suite runs red with no migration applied. The guard freeze cases run red with the migration's columns applied but the guard re-create held back, so their red is the guard's own and not "column missing"
- [x] Migration applies cleanly from scratch: `pnpm exec supabase db reset`
- [x] Notifier credential suite passes: `pnpm test:integration src/test/job-notifier-credential.integration.test.ts`
- [x] Solver credential, job attribution and role matrix suites pass: `pnpm test:integration src/test/solver-credential.integration.test.ts src/test/job-attribution.integration.test.ts src/test/role-matrix.integration.test.ts`
- [x] Generated types regenerated and diff limited to the four columns: `pnpm db:types`
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD gates pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- [x] `node scripts/provision-notifier-user.mjs` creates the local notifier user, a second run rotates it, and `node scripts/provision-solver-user.mjs` still behaves exactly as before
- [x] Grant posture read live, not from the migration: `has_table_privilege`/`has_column_privilege` for `job_notifier` matches the suite's lists

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Opt-in at Generate

### Overview

The Generate dialog gains the checkbox, shown only when the notifier is configured, and its value travels down the launch chain to the job row.

### Changes Required:

#### 1. One config reader, shared by the route and the cron

**File**: `src/entities/timetable/api/job-email-config.ts` (+ `.test.ts`), beside `solver-config.ts` and imported by path like it (not in the entity barrel); `src/cloudflare-env.d.ts` (the env keys, moved here from Phase 5 so `pnpm check` passes in this phase)

**Intent**: One answer to "is the job email configured here?", so the dialog and the cron (Phase 5) can never disagree. A pure reader over an env object, plus a thin accessor over `cloudflare:workers`' module-scope `env`, following `solver-config.ts`. It checks presence only: a wrong password still shows the box, and the cron then logs its grant failure.

**Contract**:
- `readJobEmailConfig(env)` returns `{ ok: true; config }` or `{ ok: false; missing: string[] }`. Required: `SUPABASE_URL`, `SUPABASE_KEY`, `NOTIFIER_MACHINE_PASSWORD`, `APP_ORIGIN`, and exactly one of `RESEND_API_KEY`/`MAILPIT_URL` ("both set" is reported as a configuration error). Optional: `NOTIFIER_MACHINE_EMAIL`, defaulting to the provisioning script's default.
- `isJobEmailAvailable(): boolean` reads the Worker's `env`.
- Unit tests: each missing key reported by name, both transports set, and the optional email default.

#### 2. The route computes the prop

**File**: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro`, `PlannerBoard.tsx`

**Intent**: Compute `jobEmailAvailable` at the route, as `canEdit` is computed there (`index.astro:28-32`) and as `forgot.astro:8-14` computes `configured`, and thread it down to `GenerateButton` as a prop. Islands never read env.

**Contract**: A boolean prop on each hop. No other behavior changes.

#### 3. The dialog

**File**: `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx`, `GenerateButton.test.tsx`

**Intent**: When `jobEmailAvailable` is true, add a `Checkbox` labelled "Email me when it finishes" under the policy choice, with one muted sentence saying the email goes to the author's account address and that the choice can't be changed once the job starts. The checkbox is ticked every time the dialog opens, reset in `onOpenChange` like the preset seed, and never seeded from a previous job. When it is false, the checkbox is absent, never disabled. Confirm passes `jobEmailAvailable && checked` to `launch`.

**Contract**: `launch(policy: SolvePolicy, options: { emailOnFinish: boolean })`. Tests:
- ticked on open;
- re-ticked on re-open after unticking;
- `launch` receives the current value;
- absent when `jobEmailAvailable` is false, and `launch` then receives `emailOnFinish: false`;
- the existing assertion at `:212` is updated.
Semantic tokens only (lessons.md). The server does not re-check availability: a crafted action call can only opt in the caller's own job, which is then emailed once the notifier is configured, within the 24 h lookback.

#### 4. The launch chain

**File**: `src/_pages/plan-detail/model/generation/use-generation-job.ts`, `src/_pages/plan-detail/api/generation-client.ts`, `src/_pages/plan-detail/api/generation-job.ts`

**Intent**: Thread `emailOnFinish` through `GenerationJobControls.launch`, the `start` dependency, the client `startGeneration`, and the action input to `insertJob`, which writes `email_requested`.

**Contract**:
- `startGenerationInput` gains `emailOnFinish: z.boolean().default(false)`, so a direct caller that omits it never opts in.
- `insertJob`'s row type gains `emailRequested`.
- `generation-actions.ts` needs no change (schema-driven).

#### 5. Persistence test

**File**: `src/_pages/plan-detail/api/generation-enqueue.integration.test.ts`

**Intent**: Prove the flag lands on the row when asked, and defaults to false when the caller omits it.

**Contract**: Two cases, read back with the service role.

### Success Criteria:

#### Automated Verification:

- [x] Dialog, hook and config-reader unit tests pass: `pnpm test src/_pages/plan-detail src/entities/timetable/api/job-email-config.test.ts`
- [x] Enqueue integration passes: `pnpm test:integration src/_pages/plan-detail/api/generation-enqueue.integration.test.ts`
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD gates pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- [x] In `pnpm build && pnpm preview`, with the job-email keys in `.dev.vars` (presence is enough; the notifier need not exist yet), the dialog shows the ticked checkbox on every open in light and dark themes, and an opted-out launch writes `email_requested = false` (checked in Studio). After removing `NOTIFIER_MACHINE_PASSWORD` and rebuilding, the checkbox is absent and a launch writes `false`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Email decision, content and transport

### Overview

Everything that decides and says, plus the two ways to send, built as pure or fetch-injected code under Vitest. No database.

### Changes Required:

#### 1. The decision

**File**: `src/entities/timetable/model/generation/job-email.ts` (+ `.test.ts`), re-exported through `src/entities/timetable/index.ts`

**Intent**: Implement the Implementation Approach's decision table as a pure function over a row projection plus the recipient facts and an injected `nowMs`. Reuse `isStaleActiveJob` and `isTerminalJobStatus`, never a second threshold.

**Contract**:
- Two stages, because the sweep reads recipients only for jobs that get past the first:
  - `decideJobPhase(job: JobEmailJobFacts, nowMs: number)` returns `{ kind: "wait" } | { kind: "skip"; outcome } | { kind: "needs-recipient"; email: JobEmailKind }`. It covers the table's job-only rows (expired, wait, self-stop) and fixes the send kind (stalled, or the terminal status).
  - `decideRecipient(phase: NeedsRecipient, recipient: JobEmailRecipientFacts | null)` returns `{ kind: "skip"; outcome: "no_recipient" | "recipient_fenced" } | { kind: "send"; email: JobEmailKind }`. `null` means `requested_by` is null or there is no directory row.
  - `decideJobEmail(job, recipient, nowMs): JobEmailDecision` composes the two. The table's order is tested through it.
- `JobEmailKind` is `finished | failed | interrupted | stopped | stalled`.
- `JOB_EMAIL_LOOKBACK_MS = 24 h` (with its idempotency-window note).
- Tests cover every row of the table, in order, including:
  - boundaries at exactly 24 h and exactly the heartbeat grace;
  - an admin stop (sent) vs a self-stop (skipped);
  - a stop by a since-deleted user (`stop_requested_by` null: sent);
  - a viewer requester (sent);
  - a stale `queued` row (stalled).
- Declarative style (lessons.md).

#### 2. The content

**File**: `src/entities/timetable/model/generation/job-email-content.ts` (+ `.test.ts`)

**Intent**: Build the subject, plain text and HTML for a send decision from row facts and an origin. The wording is honest per research C3: "finished: open it to review", never "ready".

**Contract**: `buildJobEmail(kind, facts, origin): { subject; text; html; link }`.
- **Subject:** starts with "IB Planner:" and names the outcome and the plan.
- **Body:**
  - the outcome sentence;
  - the duration from row timestamps;
  - `policyLabel(parseStoredPolicy(policy).preset)` (`policy.ts:38,47`). The stored column holds legacy shapes, and `policyLabel` takes a preset;
  - when a board exists ("all courses placed" or "N course groups could not be placed"): `result.diagnostics` for `succeeded`, `checkpoint.diagnostics` for a halted job with `checkpoint_stage_index`, and nothing otherwise;
  - one footer line naming why they got it ("you ticked 'Email me when it finishes'").
- **Link, exactly one:**
  - `/plans/<proposal_plan_id>` for `succeeded`, or for a halted job with a checkpoint;
  - `/plans/<plan_id>` for everything else, or when there is no proposal.
- **Tests:**
  - one URL, under the origin;
  - no `<form|<script|<img`;
  - an HTML-hostile plan name is escaped;
  - a CR/LF in the name never reaches the subject;
  - the output is identical for identical input (no clock);
  - no field carries an `error` value.

#### 3. The sender identity

**File**: `src/shared/config/` (new concept file, exported through the barrel)

**Intent**: One constant for the sender, "IB Planner" `<team@ib-timetable-planner.dev>`, matching the S-402 sender (`email-delivery.md:57-67`).

**Contract**: `JOB_EMAIL_FROM = { name, address }`.

#### 4. The transports

**File**: `src/shared/api/mail/` (new folder: `index.ts` pure barrel, `mail-transport.ts`, `resend-transport.ts`, `mailpit-transport.ts`, `select-mail-transport.ts`, tests beside each), re-exported through `src/shared/api/index.ts`; `src/shared/lib/loopback-host/` (new: `index.ts` barrel, `is-loopback-host.ts` + test); `src/_pages/password-recovery/model/turnstile-verdict.ts`

**Intent**: A transport port with two adapters, chosen by explicit config and never by sniffing the host. Each adapter classifies the provider's answers into outcomes the sweep acts on, and never logs or returns an address or a response body.
- **Public API:** consumers outside `shared` import from `@/shared/api`, never `@/shared/api/mail`. Steiger's recommended config flags a deep import into a `shared/api` subfolder as a "forbidden sidestep of public API" (only `shared/ui` and `shared/lib` subfolders are exempt).
- **One loopback check:** move Turnstile's private `LOOPBACK_HOSTS`/`isLoopback` (`turnstile-verdict.ts:76-78`) into `src/shared/lib/loopback-host/` as `isLoopbackHost(hostname)`, and point both Turnstile and the Mailpit transport at it. Turnstile's behavior is unchanged (its existing tests stay green). The `src/test/` and `scripts/lib/` copies are left alone.

**Contract**:
- **The port:** `interface MailTransport { send(message: OutgoingMail): Promise<SendOutcome> }`.
  - `OutgoingMail` is `{ to, subject, text, html, idempotencyKey }`.
  - `SendOutcome` is `sent | already-sent | in-flight | stop-tick(quota|rate-limited|credential) | failed(status, name)`.
- **Resend:**
  - POST with `Authorization: Bearer`, `Idempotency-Key`, a generic `User-Agent`, and a timeout;
  - 2xx → sent;
  - 409 `concurrent_idempotent_requests` → in-flight;
  - 409 `invalid_idempotent_request` → already-sent;
  - 429 `daily_quota_exceeded`/`monthly_quota_exceeded` → stop-tick(quota);
  - 429 `rate_limit_exceeded` → stop-tick(rate-limited);
  - 401 or 403 → stop-tick(credential). A revoked, invalid or restricted key, or an unverified domain, fails every message alike, so retrying each due job every 5 minutes would only spend calls;
  - anything else → failed.
- **Mailpit:** refuses a non-loopback URL at construction (`isLoopbackHost`). POSTs `/api/v1/send`; 200 → sent.
- **Selection:** `selectMailTransport({ RESEND_API_KEY, MAILPIT_URL })` returns Resend if only the key is set, Mailpit if only the URL is set, and `null` if neither or both are set (both is a configuration error).
- Tests use an injected fake `fetch`.

### Success Criteria:

#### Automated Verification:

- [x] Unit tests pass: `pnpm test src/entities/timetable src/shared src/_pages/password-recovery` (the last for Turnstile on the moved loopback check)
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD gates pass: `pnpm lint && pnpm steiger`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: The sweep

### Overview

The orchestration that reads due jobs under the notifier's own session, decides, claims, sends and stamps. It is proven end to end through Mailpit.

### Changes Required:

#### 1. Mailpit send probe

**File**: none (recorded in the commit or PR)

**Intent**: Before relying on it, confirm against the running stack that `POST http://127.0.0.1:54324/api/v1/send` returns 200 `{ID}` with no auth. Delete that one probe message by its ID, never with an empty ID list.

**Contract**: If the probe fails, stop and revisit the local transport before writing the suite.

#### 2. The sweep

**File**: `src/entities/timetable/api/job-email-sweep.ts` (not in the entity barrel; imported by path from the cron module, like `solver-config.ts`)

**Intent**: One tick's work, with everything injected (client, transport, origin, `nowMs`), so the integration suite drives it directly.

**Contract**: `sweepJobEmails(supabase, transport, { origin, nowMs }): Promise<JobEmailSweepReport>`, with counts `{ sent, skipped, waiting, deferred, failed }`. Each tick:
1. Select up to a bounded batch of due rows ordered by `created_at`. Read `diagnostics` only, through PostgREST JSON paths on `result`/`checkpoint`, never the whole payloads.
2. Run `decideJobPhase` on the job facts. Batch-read `user_directory`, `user_roles` and `plans` only for rows whose phase is `needs-recipient`, then run `decideRecipient` on them.
3. A skip stamps `emailed_at` and its outcome (CAS on `emailed_at is null`).
4. A send:
   - claims `email_claimed_at` (CAS: `emailed_at` null and the claim null or older than 5 min; no row back means another tick has it);
   - sends with `idempotencyKey = job-email/<job id>`;
   - on `sent`/`already-sent`, stamps `emailed_at` + `sent`/`sent_stalled`;
   - on `in-flight`/`failed`, leaves the claim;
   - on `stop-tick`, leaves the claim and ends the loop (`deferred`).
5. The report carries counts only.

#### 3. Factory support

**File**: `src/test/factories/add-generation-job.ts` (and `generation-job-row.ts` if needed)

**Intent**: Let a test set the job-email fields and lifecycle timestamps directly (service role): `emailRequested`, `startedAt`, `finishedAt`, `heartbeatAt`, `stopRequestedBy`, `proposalPlanId`, `error`, and a `result`/`checkpoint` carrying diagnostics.

**Contract**: Optional inputs. Existing callers are unchanged. The signed-in notifier client comes from Phase 1's `createSignedInMachineUser(admin, "job_notifier")`.

#### 4. Sweep integration suite

**File**: `src/test/job-email.integration.test.ts` (new)

**Intent**: Run the real sweep under a signed-in `job_notifier` client, with the Mailpit transport and the origin `http://localhost:4321`. Use unique addresses per test, and assert per address, because the sweep is global and other mail may exist.

**Contract**: Cases:
- **An opted-in `succeeded` job:**
  - exactly one message to the requester;
  - subject prefix;
  - one URL, to `/plans/<proposal id>`;
  - no `<form|<script|<img`;
  - a sentinel string planted in `error` absent from HTML and text;
  - the counts line present;
  - row stamped `sent`.
- **A second sweep** sends nothing.
- **Never opted in:** no message, row untouched.
- **Fenced requesters:** pending (`mustChangePassword`), deactivated, and role-less (the matrix's `pendingAdmin`/`deactivatedAdmin` postures) get no message, outcome `recipient_fenced`.
- **Null requester:** `no_recipient`.
- **Self-stop:** `stopped_by_requester`, no message. **An admin's stop:** message.
- **A stale `running` row:** one `stalled` message (`sent_stalled`). After a service-role update to `interrupted`, a further sweep sends nothing.
- **An event 25 h old:** `expired`, no message.
- **A viewer requester:** message.
- **Two sweeps run concurrently** over the same due job: exactly one message.

### Success Criteria:

#### Automated Verification:

- [x] Mailpit send API probe answered 200 on the local stack (recorded)
- [x] Sweep suite passes: `pnpm test:integration src/test/job-email.integration.test.ts`
- [x] Full integration lane passes: `pnpm test:integration` (a known ~1-in-5 parallel flake on `main` is not this diff's failure; rerun before blaming it)
- [x] Unit tests pass: `pnpm test`
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD gates pass: `pnpm lint && pnpm steiger`

#### Manual Verification:

- [x] A sweep-sent message, opened in Mailpit's UI (`http://127.0.0.1:54324`), reads well as plain text and as HTML in both outcomes checked (`succeeded`, `stalled`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Worker cron wiring

### Overview

The Worker gains its `scheduled` entry and its cron. It signs in as the notifier, picks the transport, and runs the sweep. Unconfigured, it is quiet.

### Changes Required:

#### 1. The cron module

**File**: `src/job-email-cron.ts` (+ `src/job-email-cron.test.ts`), top-level beside `worker.ts` (outside steiger's layers, like `solver-container.ts`)

**Intent**: Read config from the handler's `env` argument (testable; no new `astro:env` schema) through Phase 2's `readJobEmailConfig`, the same reader the route uses, so the checkbox and the cron never disagree. If anything required is missing, log `[job-email] disabled: missing <names>` once per isolate and return. Otherwise get a signed-in notifier client, select the transport, run the sweep with `controller.scheduledTime` as `nowMs`, and log one counts-only line. Never log an address. Never throw out of `scheduled` for an expected condition.

**Contract**:
- Config comes from `readJobEmailConfig(env)` (`src/entities/timetable/api/job-email-config.ts`, Phase 2). No second reader.
- The session is held in module scope and reused while unexpired. Otherwise one password grant; a grant failure (including 429) skips the tick.
- A comment beside the grant says it counts against GoTrue's `token_refresh` bucket (Supabase rate-limit docs: the `/token` endpoint covers password grants). The reason it is written down: `supabase/config.toml:193-196`'s stock comment reads as if sign-ins fall under `sign_in_sign_ups`.
- Unit tests (`job-email-cron.test.ts`): the `disabled` line is logged once per isolate, not per tick, and no expected condition throws.

#### 2. A machine client

**File**: `src/shared/api/machine-client.ts` (new, re-exported through the `src/shared/api/index.ts` barrel), `src/shared/api/supabase.ts`

**Intent**: A Supabase client for a machine principal with no cookies and no `astro:env` import. It takes the URL and publishable key as arguments and uses `persistSession: false` and `autoRefreshToken: false`. For its `fetch` it reuses `createSessionlessClient`'s private `timeBoundedFetch` (`supabase.ts:61-63`), moved to its own module inside `shared/api` and shared by both clients, rather than a second copy.

**Contract**: `createMachineClient(url, key)`. Sign-in stays at the caller.

#### 3. Entry, types and config

**File**: `src/worker.ts`, `src/cloudflare-env.d.ts`, `wrangler.jsonc`

**Intent**: Export `scheduled` beside `fetch`, declare the cron, and declare the new env keys by hand.

**Contract**:
- `worker.ts`: `export default { fetch: handle, scheduled } satisfies ExportedHandler<Env>`. Its docblock records that the default export now also carries `scheduled`, and that the build was checked to keep it.
- `cloudflare-env.d.ts`:
  - `ExportedHandler` gains `scheduled?(controller: ScheduledController, env: E, ctx: ExecutionContext): void | Promise<void>`;
  - a minimal `ScheduledController { readonly scheduledTime: number; readonly cron: string; noRetry(): void }`;
  - `Cloudflare.Env` gains `NOTIFIER_MACHINE_PASSWORD?`, `NOTIFIER_MACHINE_EMAIL?`, `RESEND_API_KEY?`, `MAILPIT_URL?`, `APP_ORIGIN?`, each with a one-line doc (already added in Phase 2 §1);
  - the header's consumer list gains `job-email-cron.ts` and `job-email-config.ts`.
- `wrangler.jsonc`:
  - `"triggers": { "crons": ["* * * * *"] }`, commented: UTC; a tick is cheap next to a 20–38-minute solve; every tick is idempotent;
  - `"vars": { "APP_ORIGIN": "https://ib-timetable-planner.dev" }` (non-secret and visible in the repo; locally overridden by `.dev.vars`).

#### 4. README

**File**: `README.md`

**Intent**: Local setup and production config for the cron:
- the `.envs/local.vars` snippet gains `MAILPIT_URL=http://127.0.0.1:54324`, `APP_ORIGIN=http://localhost:4321` and `NOTIFIER_MACHINE_PASSWORD=<what you provisioned>`, plus the one-time `node scripts/provision-notifier-user.mjs` step;
- the Worker secrets table gains `NOTIFIER_MACHINE_PASSWORD` and `RESEND_API_KEY` (never in any `.envs` profile);
- a short "Job emails" note: how to fire the cron locally with `curl …/cdn-cgi/local/scheduled?cron=*+*+*+*+*` after a rebuild.

**Contract**: Prose only.

#### 5. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The `src/worker.ts` bullet says the entry re-exports `handle` and `SolverContainer` **and** carries the `scheduled` handler for the job-email cron.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- [x] Cron config tests pass: `pnpm test src/job-email-cron.test.ts`
- [x] Type check passes: `pnpm check`
- [x] Lint and FSD gates pass: `pnpm lint && pnpm steiger`
- [x] Build passes and keeps the cron: `pnpm build && node -e "const c=require('./dist/server/wrangler.json'); if(!c.triggers?.crons?.includes('* * * * *')) process.exit(1)"`
- [x] The built entry's default export carries `scheduled`: `grep -rl '\[job-email\]' dist/server/` finds the cron module's log tag, so the handler was not tree-shaken away. A bare `grep scheduled` matches the word anywhere in the bundle and proves nothing. The export itself is proven by 5.6: `/cdn-cgi/local/scheduled` (confirmed in `@cloudflare/vite-plugin` 1.54.6, no flag needed) reaches `scheduled` only through the default export

#### Manual Verification:

- [x] Local smoke:
  - with the stack up, the notifier provisioned, the env profile rebuilt and `pnpm preview` (re)started, an opted-in job is finished by a real `mise run solver:dev` solve or set terminal in Studio;
  - `curl 'http://localhost:4321/cdn-cgi/local/scheduled?cron=*+*+*+*+*'` returns 200;
  - one email appears in Mailpit, with a `http://localhost:4321/plans/…` link that opens the right plan.
- [x] Unconfigured smoke: with `NOTIFIER_MACHINE_PASSWORD` removed from `.dev.vars` and a rebuild, the same curl returns 200, logs `[job-email] disabled: missing NOTIFIER_MACHINE_PASSWORD` once, and sends nothing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Runbook, docs and hosted rollout

### Overview

Write down how the notifier is provisioned, rotated and switched off, correct the documents that described the old event, then roll out on hosted after merge and see one real email arrive.

### Changes Required:

#### 1. Runbook

**File**: `docs/runbooks/job-email.md` (new)

**Intent**: The notifier's whole operational story:
- what the cron does, and that it signs in as `job_notifier` through the token hook (already enabled on hosted; the migration re-creates its body);
- provisioning and rotation with `scripts/provision-notifier-user.mjs` (hosted URL plus the secret key from the shell, never a file);
- the Resend key: a new `sending_access` key restricted to `ib-timetable-planner.dev`, named for the notifier, separate from the SMTP key;
- `wrangler secret put NOTIFIER_MACHINE_PASSWORD` / `RESEND_API_KEY`;
- the kill switch: `wrangler secret delete RESEND_API_KEY`. It is the one quiet off switch: the cron logs `disabled`, and the Generate dialog stops showing the checkbox (Phase 2's shared config reader). Revoking the key in Resend is not equivalent. The cron stays configured and the checkbox stays visible. Each tick claims the first due job, gets a 401/403, stops the tick (`stop-tick(credential)`), and logs it, until the jobs expire after 24 h;
- the shared 100/day cap, and what a 429 does;
- what Workers Logs show (`[job-email]` counts, `disabled` lines);
- never enable Supabase Auth CAPTCHA;
- the hosted check below.

**Contract**: Linked from `email-delivery.md` and `solver-credential.md`.

#### 2. Docs that describe the mechanism

**File**: `docs/runbooks/email-delivery.md`, `docs/runbooks/solver-credential.md`, `context/foundation/archive/2026-10-10-prd.md` (FR-309), `context/foundation/roadmap.md` (S-310 unknown)

**Intent**:
- `email-delivery.md:8` changes from "S-310 … will" to S-310 sending job emails through Resend's HTTP API with its own key. Its Caps section adds job emails to the shared cap.
- `solver-credential.md`'s hook description notes the second mapped role.
- FR-309 gains a dated re-grounding note: the event is the solver's terminal write, or a stale heartbeat, on an opted-in job; the marker is `emailed_at`; `notified_at` is not the emailer's.
- The roadmap's S-310 unknown is marked resolved by this plan.

**Contract**: Prose only.

#### 3. Hosted rollout (after merge, by hand)

**File**: `context/changes/job-completion-email/hosted-check.md` (new)

**Intent**: Record what was set and what was seen, with no secrets or real names, in the S-410 `hosted-check.md` style. Merge only while no production solve is running (README § Deployment).

**Contract**: Steps:
1. Confirm the migration landed: `job_notifier` grants read live with `has_column_privilege`.
2. Provision the hosted notifier.
3. Create the Resend key.
4. Set both Worker secrets.
5. Confirm a `[job-email]` counts line (not `disabled`) in Workers Logs.
6. Run one opted-in hosted Generate as an account whose address is a Gmail inbox.
7. Confirm one email in the Gmail Inbox (not Spam), SPF and DKIM passing in "Show original", and the link opening the plan on `https://ib-timetable-planner.dev`.
8. Confirm the row reads `email_outcome = 'sent'`.

### Success Criteria:

#### Automated Verification:

- [x] Formatting passes for the docs: `pnpm exec prettier --check docs/runbooks/job-email.md docs/runbooks/email-delivery.md README.md CLAUDE.md`
- [x] The full local CI gate passes before merge: `/verify`

#### Manual Verification:

- [ ] Hosted notifier provisioned, Resend key created, both Worker secrets set, and Workers Logs show the cron running (recorded in `hosted-check.md`)
- [ ] One real hosted job email received in Gmail's Inbox with SPF and DKIM passing and a working link (recorded in `hosted-check.md`)

**Implementation Note**: The two manual items happen after merge. Record them in `hosted-check.md` before archiving the change.

---

## Testing Strategy

### Unit Tests:

- `decideJobEmail`: every row of the decision table in order. Boundaries at exactly 24 h and exactly the 5-minute grace. Self-stop vs admin stop vs deleted stopper. Viewer requester. Stale `queued`.
- `buildJobEmail`: one link and the right target per kind. Counts from `result` vs `checkpoint` vs none. Escaping. CR/LF stripped from the subject. Determinism. No `error`.
- Transports: every Resend status/`name` mapping, `User-Agent` and `Idempotency-Key` present, Mailpit's loopback refusal, and the selection rule including "both set".
- `readJobEmailConfig`: each missing key reported by name, and both transports set.
- `GenerateButton`: ticked on every open, value passed to `launch`, absent (and `false` passed) when `jobEmailAvailable` is false.

### Integration Tests:

- `job-notifier-credential.integration.test.ts`: the role's full posture (claims, column lists, row scope, refusals, role attributes).
- `job-attribution.integration.test.ts`: all four email columns frozen for every signed-in principal, and the three markers forced null at a signed-in insert.
- `generation-enqueue.integration.test.ts`: the flag persisted, default false.
- `job-email.integration.test.ts`: the sweep end to end through Mailpit (Phase 4's case list).
- `role-matrix.integration.test.ts` / `solver-credential.integration.test.ts`: unchanged human cells, and the solver unaffected by the hook change.

### Manual Testing Steps:

1. Phase 2: open the dialog twice, untick once, and confirm it is ticked again on the next open. Launch opted out and check the row.
2. Phase 5: the local cron smoke through Mailpit (configured and unconfigured).
3. Phase 6: one hosted job email in Gmail, recorded.

## Performance Considerations

- One tick does one indexed due-set query (partial index), up to three small lookups, and at most a bounded batch of sends. That is far inside the Paid plan's 30 s CPU and 15 min wall time.
- The validation budget (< 200 ms per drag-drop) is untouched. Nothing here is on the board's path.
- The `plans`/`user_directory`/`user_roles` policies' subqueries hit the same partial index. Those tables are small.
- Sign-in uses about 3% of GoTrue's per-IP `token_refresh` bucket, less when the isolate's session is reused.

## Migration Notes

- **Additive only:** four nullable or defaulted columns, a check constraint, an index, a role, policies, and two function re-creates. Existing rows get `email_requested = false`, so nothing historical is ever emailed and no backfill is needed.
- **Rollback is roll-forward.** To switch the feature off, delete `RESEND_API_KEY` (kill switch). The schema stays.
- **CI order on merge:** migration → Edge Function → Worker with cron. Until the hand-made steps in Phase 6 are done, the cron is a logged no-op.

## References

- Research: `context/changes/job-completion-email/research.md`
- Role precedent: `supabase/migrations/20260810200931_solver_job_writer_role.sql`, `20260812141459_solver_select_column_scope.sql`
- Hook (live body): `supabase/migrations/20260810200934_custom_access_token_hook.sql:37-51`
- Guard (live body): `supabase/migrations/20261106192749_created_by_and_job_ownership.sql:167-224`
- Guard suite to mirror: `src/test/solver-credential.integration.test.ts`
- Email-content test pattern: `src/test/password-recovery.integration.test.ts:70-82`, `src/test/mailpit.ts`
- Staleness: `src/entities/timetable/model/generation/job-staleness.ts:23-57`
- Hosted-check precedent: `context/archive/2026-11-10-invite-by-email/hosted-check.md`

## Implementation Addenda (2026-11-19)

Recorded by the implementation review (`reviews/impl-review.md`). The phase commits already record the other departures: `isLoopbackHost` in `shared/config`, `MailTransport` as a `type`, the counts wording, `chooseMailTransport`, skips honouring a live claim, and `job-email-availability.ts`.

**Departures no commit recorded:**
- `readJobEmailConfig` returns `{ ok: false; problems: string[] }`, not `missing`. It also parses `APP_ORIGIN`: it must be http(s), and only its origin is kept. Phase 2 said "presence only"; this fails closed and is tested.
- Every Resend 429 whose `name` is not a quota name maps to `stop-tick(rate-limited)`, not only `rate_limit_exceeded`.
- The decision uses `isActiveJobStatus`, the exact inverse of `isTerminalJobStatus`.

**Review fixes:**
- **F1:** a `failed` job with `started_at` null (its dispatch was refused, so the author saw the error at Generate) skips with the new outcome `dispatch_refused`. The decision table and the check constraint above show it, and the migration was edited in place before merge.
- **F2:** claims are dated and judged by the live clock, not the run's `nowMs`, so a long run's later claims cannot look expired to an overlapping run.
- **F3:** the sweep report carries `stoppedBy` and each failure's status and name, and the cron's counts line prints them: `deferred=… (credential)`, `failed=… (422 validation_error)`.
- **F5:** a halted email claims a kept board, and counts it, only while the proposal plan still exists.
- **F6:** the notifier's `plans` policy admits only a due job's source plan, not its proposal plan. The sweep reads only the source plan's name, and the link uses the id from the job row. The migration was edited in place before merge.

**Simplification pass (second review, 2026-11-19), behaviour unchanged:**
- `selectMailTransport` (Phase 3's planned selector) is removed: nothing called it. The config reader calls `chooseMailTransport`, and the cron builds from its choice with `createMailTransport`.
- The cron's cached session no longer records an identity (URL and email). A Worker's env is fixed for an isolate's life, so the session is judged by its expiry alone.
- The email content derives the link, the counts line and the call to action from one value, the proposal plan holding a board (or null), where it had a boolean plus a second null check.
- The sweep passes a due row with a recognised status straight to `decideJobPhase`, with no field-by-field copy.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database and notifier identity

#### Automated

- [x] 1.1 The notifier credential suite and the guard freeze cases fail before the migration (red recorded in the commit message or PR) — c8428455
- [x] 1.2 Migration applies cleanly from scratch: `pnpm exec supabase db reset` — c8428455
- [x] 1.3 Notifier credential suite passes — c8428455
- [x] 1.4 Solver credential, job attribution and role matrix suites pass — c8428455
- [x] 1.5 Generated types regenerated and diff limited to the four columns — c8428455
- [x] 1.6 Type check passes: `pnpm check` — c8428455
- [x] 1.7 Lint and FSD gates pass — c8428455

#### Manual

- [x] 1.8 Notifier provisioning creates and rotates; solver provisioning unchanged — c8428455
- [x] 1.9 Grant posture read live matches the suite's lists — c8428455

### Phase 2: Opt-in at Generate

#### Automated

- [x] 2.1 Dialog and hook unit tests pass — 9086cf05
- [x] 2.2 Enqueue integration passes — 9086cf05
- [x] 2.3 Type check passes: `pnpm check` — 9086cf05
- [x] 2.4 Lint and FSD gates pass — 9086cf05

#### Manual

- [x] 2.5 Dialog shows the ticked checkbox on every open; an opted-out launch writes false — 9086cf05

### Phase 3: Email decision, content and transport

#### Automated

- [x] 3.1 Unit tests pass for entities and shared — 10c680c8
- [x] 3.2 Type check passes: `pnpm check` — 10c680c8
- [x] 3.3 Lint and FSD gates pass — 10c680c8

### Phase 4: The sweep

#### Automated

- [x] 4.1 Mailpit send API probe answered 200 on the local stack (recorded) — 8da9264d
- [x] 4.2 Sweep suite passes — 8da9264d
- [x] 4.3 Full integration lane passes — 8da9264d
- [x] 4.4 Unit tests pass: `pnpm test` — 8da9264d
- [x] 4.5 Type check passes: `pnpm check` — 8da9264d
- [x] 4.6 Lint and FSD gates pass — 8da9264d

#### Manual

- [x] 4.7 Sweep-sent messages read well in Mailpit (succeeded, stalled) — 8da9264d

### Phase 5: Worker cron wiring

#### Automated

- [x] 5.1 Cron config tests pass — 8743da93
- [x] 5.2 Type check passes: `pnpm check` — 8743da93
- [x] 5.3 Lint and FSD gates pass — 8743da93
- [x] 5.4 Build passes and keeps the cron in `dist/server/wrangler.json` — 8743da93
- [x] 5.5 The built entry's default export carries `scheduled` — 8743da93

#### Manual

- [x] 5.6 Local cron smoke sends one email through Mailpit with a localhost link — 8743da93
- [x] 5.7 Unconfigured smoke logs `disabled` once and sends nothing — 8743da93

### Phase 6: Runbook, docs and hosted rollout

#### Automated

- [x] 6.1 Formatting passes for the docs — e9c98a7e
- [x] 6.2 The full local CI gate passes before merge: `/verify` — e9c98a7e

#### Manual

- [ ] 6.3 Hosted notifier provisioned, Resend key created, secrets set, cron running (recorded)
- [ ] 6.4 One real hosted job email received in Gmail with SPF and DKIM passing (recorded)
