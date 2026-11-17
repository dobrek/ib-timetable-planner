---
date: 2026-11-16T15:03:16+01:00
researcher: Claude (Opus 5.5)
git_commit: 2d2af4743c8198dac452e4625d9938a5094a1049
branch: email-notification-on-job-completion
repository: ib-timetable-planner
topic: "Feasibility of S-310: email the requester when a generation job completes, with no browser open"
tags: [research, codebase, generation-jobs, notifier, email, resend, cron, machine-identity, token-hook, notified-at, job-completion-email]
status: complete
last_updated: 2026-11-16
last_updated_by: Claude (Opus 5.5)
---

# Research: Feasibility of S-310, job-completion email

**Date**: 2026-11-16T15:03:16+01:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: [`2d2af47`](https://github.com/dobrek/ib-timetable-planner/tree/2d2af4743c8198dac452e4625d9938a5094a1049)
**Branch**: email-notification-on-job-completion
**Repository**: ib-timetable-planner

## Research Question

> Please check the feasibility of implementing this feature, name the challenges we could face and suggest options we have to address them.

The feature is roadmap slice **S-310** ([`roadmap.md:279-290`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/context/foundation/roadmap.md#L279-L290), issue [#107](https://github.com/dobrek/ib-timetable-planner/issues/107)). It traces to FR-309 of the archived CP-SAT PRD ([`2026-10-10-prd.md:520-549`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/context/foundation/archive/2026-10-10-prd.md#L520-L549)) and to the guardrail that no email carries student data ([`prd.md:113-114, 133`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/context/foundation/prd.md#L113-L133)). An author who presses Generate and walks away gets an email with the result when the job finishes. Both prerequisites are done: S-402 (Resend, the domain, the sender) and S-407 (`generation_jobs.requested_by`, the recipient).

## Summary

**Verdict: feasible, with no technical blocker. Sending the email is the cheap part.**
- **What it costs:** the slice is mostly a clock and a database identity, which no slice before it needed.
- **The sender:** about 20 lines of `fetch` to Resend, which the provider decision expected ([`user-managment-research/research.md:600`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/context/changes/user-managment-research/research.md#L600)).
- **The in-app half of FR-309 already exists:** S-306 shipped the toasts and the plans-list badges ([`generation-toasts.ts:34`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/model/generation-toasts.ts#L34)). Only the email is missing.

**Three findings change the slice's shape:**

1. **The event the archive planned for never fires when nobody is in the app.**
   - FR-309's re-grounding defines the event as `delivered_plan_id is not null and notified_at is null` ([`2026-10-10-prd.md:542-549`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/context/foundation/archive/2026-10-10-prd.md#L542-L549)).
   - Delivery runs only when an editor opens the source or the proposal ([`generation-delivery.ts:100-105`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L100-L105)). So on a walk-away, `delivered_plan_id` stays null.
   - The email has to key on **the solver's own terminal write** (`status` + `finished_at`, [`supabase.py:236-257`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/services/solver/src/cpsat_service/supabase.py#L236-L257)). That write happens before the server-side check, which can still turn `succeeded` into `failed` ([`generation-delivery.ts:228-239`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L228-L239)).
2. **`notified_at` cannot be the email's marker.**
   - The plans list keeps "Ready — open" on a badge only while `notified_at` is null ([`generation-status.ts:93-99`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/api/generation-status.ts#L93-L99)). If the emailer stamped it, the badge would never show.
   - Failed jobs never get a `notified_at` at all, so it cannot prevent a second email about a failure either.
   - The "second writer" plan in [`20260828093000:56-57`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql#L56-L57) and [`generation-delivery.ts:115`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L115) has to be retired. The email gets its own column, and it reads `notified_at` only as "the author has already seen it".
3. **Every way to read the recipient bends at least one house rule. The choice is which rule.**
   - **The Worker:** its only database clients are bound to a request's cookies or are anonymous ([`supabase.ts:7-53`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/shared/api/supabase.ts#L7-L53)). `anon` is revoked on `generation_jobs`.
   - **The solver's role:** it cannot read `requested_by`, `plan_id` or `user_directory`.
   - **The token hook:** it maps exactly one machine role ([`custom_access_token_hook.sql:46`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260810200934_custom_access_token_hook.sql#L46)).
   - **The secret key:** only `admin-users` holds it.

**Recommended direction (T1):**
- A **Worker Cron Trigger** sweeps every minute and signs in as a **new narrow machine user, `job_notifier`**. It is built exactly like `solver_job_writer`: a machine Auth user, the token hook mapping it to its own role, column-scoped grants and `to job_notifier` policies.
- It sends through **Resend's HTTP API** with its own sending-only key and an `Idempotency-Key`, and stamps a new `emailed_at` column.
- Why this one: it adds no secret key anywhere, no second `SECURITY DEFINER`, no new Supabase extension and no new Edge Function. It also reuses a pattern the repo has already proven and tested.
- What it costs: one more value in the token hook's allowlist, plus everything a second machine principal needs (grants, policies, a credential suite, provisioning, a runbook). And for the first time, the Worker signs in with a credential of its own.
- **Runner-up (T2):** Supabase Cron calls a new Edge Function that reads with the secret key. It is fewer moving parts in the database, but it breaks the rule "only `admin-users` holds the secret key", and it goes against the solver precedent that a secret key "cannot be scoped to a table, schema, or role".

**Challenges, most consequential first:**

| #   | Challenge                                                        | Failure if ignored                                                                     | Recommended option                                                                                 | Confidence                |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| C1  | Nothing fires with no tab open                                   | The email waits for the author to come back, which defeats its purpose                 | A Worker Cron Trigger, every minute                                                                | Code + docs               |
| C2  | The notifier has no database identity                            | It can't read the job or the recipient under fail-closed RLS                           | A new `job_notifier` machine role, built like the solver's                                         | Code + archive            |
| C3  | The planned event can't fire, and "succeeded" isn't verified yet | No email on a walk-away, or an email promising a board that later fails the check       | Key on the solver's terminal write; word it "finished — open to review"                            | Code                      |
| C4  | `notified_at` can't be shared                                    | "Ready — open" badges vanish; failure emails repeat                                    | New `emailed_at` column; read `notified_at` only as "already seen"                                 | Code                      |
| C5  | First deploy and outages would flood                             | Every historical job gets emailed when the feature ships                               | Backfill `emailed_at` for existing terminal rows, plus a 24 h lookback window                      | Code                      |
| C6  | Duplicate and lost sends                                         | Two ticks send twice, or a timeout loses the email                                     | Claim with a compare-and-set, send with `Idempotency-Key: job-complete/<id>`, stamp on 2xx         | Docs                      |
| C7  | There is no app-level sender                                     | GoTrue can't send this mail; a Send Email Hook would take over all Auth mail           | Resend HTTP adapter with a new sending-only key restricted to the domain                           | Code + docs               |
| C8  | Testing locally and in CI                                        | CI can't reach Resend; the cron doesn't fire under `pnpm preview`                      | A transport port: Resend in production, Mailpit locally; integration tests call the sweep directly | Code; Mailpit API unverified |
| C9  | Shared 100/day Resend quota                                      | Job emails starve password resets and invitations                                      | An app-side daily cap on job emails (or Resend Pro)                                                | Runbook                   |
| C10 | Which outcomes send, including a dead container                  | Noise (self-stops), or silence (a dead container leaves the row `running`)             | Send on succeeded, interrupted, failed, and stopped by someone else; decide on "stalled"           | Code                      |
| C11 | Recipient fences and edge cases                                  | Mail to a deactivated or pending account, or to nobody                                 | Same predicate as `current_app_role()`, pinned by tests against the fenced principals              | Code                      |
| C12 | Content: no student data, one link, an origin                    | Error text leaks ids or catalog names; a link with no origin                           | No `error` text; counts only; one link to `/plans/<id>`; a configured `APP_ORIGIN`                 | Code                      |
| C13 | School inbox delivery isn't proven                               | Mail lands in Junk or Promotions and nobody sees it                                    | Plain mail from `team@`; one real job email to the school mailbox before done                      | Archive                   |
| C14 | Worker entry and tooling gaps                                    | A build that loses the cron, or a cron that can't read its env                         | `export default { fetch, scheduled }`, `triggers.crons`, read `env` from the handler's argument    | Docs; adapter unverified  |
| C15 | Hosted rollout order                                             | The cron fires before its user or secrets exist                                        | Fail closed and quiet; a provisioning runbook; a hosted check                                      | Archive                   |

"Code" means read in this repo at `2d2af47`. "Docs" means current platform documentation, fetched on 2026-11-16 (Supabase, Cloudflare, Resend). "Archive" means a recorded decision under `context/`. Items not proven by a run are listed in [§ Not verified](#not-verified).

## Recommended design (T1)

```
Cloudflare Cron Trigger "* * * * *"          wrangler.jsonc  triggers.crons (none today)
  └─ src/worker.ts   export default { fetch: handle, scheduled }
       └─ sweepJobEmails(env, now)                     no request, no cookies, no secret key
            ├─ sign in as job_notifier                 password grant, publishable key
            │     → token hook maps machine_role "job_notifier" → claims.role = job_notifier
            ├─ due jobs: status terminal                (succeeded | stopped | interrupted | failed)
            │            and finished_at > now() - 24 h       ← C5 lookback
            │            and finished_at < now() - 2 min      ← grace: an author watching gets it in-app
            │            and emailed_at is null and notified_at is null and requested_by is not null
            ├─ per job:
            │    recipient  user_directory(email, must_change_password)
            │               user_roles(role, deactivated_at), profiles(display_name)
            │    plan       plans(name) for the source plan or the proposal
            │    skip, stamped with a reason, when fenced, without a role, or stopped by themselves  ← C10, C11
            │    claim      CAS email_claimed_at (null or older than 5 min) → else another tick has it
            │    send       POST https://api.resend.com/emails
            │               Idempotency-Key: job-complete/<job id>        ← C6 (24 h window)
            │    stamp      emailed_at = now() on 2xx; on failure leave the claim to expire (retried)
            └─ log counts only, never addresses
DB (additive migration):
  generation_jobs + emailed_at, email_claimed_at  (+ backfill emailed_at for existing terminal rows)
  role job_notifier: nologin, granted to authenticator, no default privileges
     SELECT (column-scoped) on generation_jobs, plans, user_directory, user_roles, profiles
     UPDATE (emailed_at, email_claimed_at) on generation_jobs
     `to job_notifier` policies; the machine user never holds a user_roles row
  custom_access_token_hook: allowlist {solver_job_writer, job_notifier}  (re-created from the live body)
Worker secrets: NOTIFIER_MACHINE_PASSWORD, RESEND_API_KEY (new key, sending only, this domain)
Worker var:     APP_ORIGIN (https://ib-timetable-planner.dev; http://localhost:4321 locally)
```

No public route, no new Edge Function, no Supabase extension, no Vault and no CI stack change. The email is plain HTML with exactly one link, sent from `team@ib-timetable-planner.dev` as "IB Planner" ([`email-delivery.md:57-67`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/docs/runbooks/email-delivery.md#L57-L67)).

## Detailed Findings

### 1. The job lifecycle: who writes what, and whether a browser is needed

`generation_jobs.status` is one of `queued, running, succeeded, failed, stopped, interrupted` ([`20260810200122:63, 96-97`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260810200122_generation_jobs.sql#L63-L97)). Any status other than queued or running is terminal.

| Transition                                       | Writer                                                                                                                                                                                                                                                   | Needs a browser?                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| insert → `queued`                                | Worker `startGeneration`; the guard trigger stamps `requested_by` ([`20261106192749:175-182`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20261106192749_created_by_and_job_ownership.sql#L175-L182)) | Yes, the Generate request                  |
| `queued` → `running`, then per-stage progress    | The solver, as `solver_job_writer`                                                                                                                                                                                                                       | **No**                                     |
| `running` → `succeeded`, `failed` or `interrupted` | The solver's `finish` ([`supabase.py:236-257`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/services/solver/src/cpsat_service/supabase.py#L236-L257)), including on SIGTERM                     | **No**                                     |
| `running` → `stopped`                            | The user's stop sets a flag; the solver's heartbeat sees it and writes `stopped`                                                                                                                                                                         | Only the request; **not** the terminal write |
| A wedged `queued`/`running` row → `interrupted`  | `reclaimStaleJob`, only during an editor's visit or Generate ([`generation-delivery.ts:70-77`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L70-L77): *"nothing else in the system sweeps it (no cron, and a `scheduled` handler has no database identity here)"*) | Yes, an editor                             |
| Delivery: `delivered_plan_id`, `delivery='proposal'` | `checkPlan` → the oracle → `markDelivered`                                                                                                                                                                                                         | Yes, an editor                             |
| `succeeded` → `failed` at delivery               | The oracle rejects the board ([`generation-delivery.ts:228-239`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L228-L239))                   | Yes, an editor                             |

- **The only completion signal that needs no browser** is the solver's terminal write: `status` plus `finished_at`.
- **A container that dies silently** leaves the row `running` until an editor visits ([`job-staleness.ts:23, 45`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/entities/timetable/model/generation/job-staleness.ts#L23-L57): a 5-minute grace over a 15 s heartbeat).
- **The Durable Object never observes a job.** `SolverContainer.onActivityExpired` only counts active solves, and only to decide whether to sleep ([`solver-container.ts:85-99`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/solver-container.ts#L85-L99)).
- **Tier 1, CI and the hosted campaign bypass the Durable Object entirely**: `SOLVER_URL` takes precedence over it.
- **The Worker exports `fetch` only** ([`worker.ts:26`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/worker.ts#L26)), and `wrangler.jsonc` has no `triggers`.

### 2. `notified_at` and the in-app half

- **The only writer is `markNotified`.** It runs during a proposal-page visit by an editor, and only once the job is delivered ([`generation-delivery.ts:100-139`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L100-L139)).
- **What it means:** "an editor has opened the delivered proposal once".
- **The only reader is the plans-list hub's filter** ([`generation-status.ts:93-99`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/api/generation-status.ts#L93-L99)). Its third clause, `delivered_plan_id not null and notified_at is null`, is what keeps "Ready — open" on the badge across reloads.
- **A delivery started from a source-page visit never stamps it** (`role === "source"` returns early, `:102`). If the emailer stamped `notified_at` before delivery, the clause would never match, and that badge would never appear.
- **The in-app half of FR-309 is done.**
  - The hub shows badges ("Ready — open", "Finished — open to deliver", "Failed — open plan", "stalled").
  - It shows toasts when a job goes from active to terminal ([`generation-toasts.ts:34`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/model/generation-toasts.ts#L34)).
  - It polls every 5 s while a job is active and the tab is visible.
  - The pending proposal page polls and reloads into the board once the job is delivered.

### 3. Identity: what can read the job and the recipient

**What `solver_job_writer` can do:**
- **Read:** only `id, status, snapshot_hash, heartbeat_at, stop_requested_at`, by column grant ([`20260812141459:71-72`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260812141459_solver_select_column_scope.sql#L71-L72)).
- **Write:** only the solver's own columns, and only on rows that are still active.
- **Elsewhere:** nothing on `user_directory`, `plans` or `profiles`.
- **What the solver knows at the end of a job:** the job id, the snapshot of opaque ids and its result. It does not know `plan_id`, the requester or any name.

**Where the recipient lives:**
- **Email:** `user_directory.email`, readable as your own row or by anyone who holds a role ([`user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20261105073614_user_directory.sql#L74-L76)). Machine rows are hidden.
- **Fences:** `user_directory.must_change_password`, `user_roles.deactivated_at`, and a missing `user_roles` row. `private.current_app_role()` folds all three into null, but only for the caller (`20261112110654_deactivation_fence.sql:67-84`).
- **Bans:** `banned_at` records only bans made in the app, which also set `deactivated_at` (`20261113123108_account_ban.sql:6-13`). A ban made in the dashboard is invisible.
- **A deleted requester:** `requested_by` is set to null on delete, and it is also null on rows from before S-407 (`20261106192749:127-145`).

**The Worker:**
- **Its clients:** `createClient` is bound to the request's cookies. `createSessionlessClient` uses the publishable key with no session, so it acts as `anon` ([`supabase.ts:7-53`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/shared/api/supabase.ts#L7-L53)). `anon` is fully revoked on `generation_jobs` (`20260810200122:128-129`).
- **Its secrets:** it holds no secret key, by decision of record (`deploy-plan.md:141`).
- **The solver's password:** it carries `SOLVER_MACHINE_PASSWORD` only as a courier to the container (README, secrets table).

**The token hook** passes the event through unchanged unless `machine_role` is exactly `solver_job_writer` ([`custom_access_token_hook.sql:37-55`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260810200934_custom_access_token_hook.sql#L37-L55)). The migration's own header says widening the allowlist is "a deliberate one-line edit in a reviewed migration". CLAUDE.md repeats the rule as "solely for the exact value `solver_job_writer`". That sentence would need amending.

**The role matrix's structural checks hard-code the solver as the only machine policy holder.** They filter `p.roles <> '{solver_job_writer}'` at [`role-matrix.integration.test.ts:664`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/test/role-matrix.integration.test.ts#L664) and [`:697`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/test/role-matrix.integration.test.ts#L697). A `to job_notifier` policy would fail both checks until that filter covers every machine role.

### 4. Sending: what exists and what doesn't

- **All product mail today goes through GoTrue over SMTP to Resend.** That covers password resets, invitations and the password-changed notice. No app code sends mail.
- **The SMTP key is sending-only, lives only in Supabase, and "never reaches the Worker"** ([`email-delivery.md:22-23`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/docs/runbooks/email-delivery.md#L22-L23)). The runbook also states that S-310 will reuse the provider (`:8-9`).
- **GoTrue cannot send non-Auth mail.** Its Send Email Hook fires only for Auth's own events, and turning it on would take over every Auth email from SMTP (Supabase docs, Send Email Hook).
- **Resend's HTTP API** (docs, fetched 2026-11-16):
  - **Call:** `POST https://api.resend.com/emails`, with a Bearer key.
  - **`Idempotency-Key`:** up to 256 characters, and it lasts **24 h**. A failed request is not stored, so it can be retried with the same key.
  - **Rate limit:** 10 requests/s per team.
  - **Quota:** Free allows **100 per UTC day** and 3,000 per month, per account.
  - **Keys:** a key can be `sending_access` and restricted to one domain. Resend advises one key per service.
- **The daily cap is shared.** It is "the effective global cap, shared by resets, password-changed notifications and invitations" ([`email-delivery.md:71-80`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/docs/runbooks/email-delivery.md#L71-L80)).
- **Cloudflare Email Service** is still labelled beta (Email Sending public beta 2026-04-16, overview updated Oct 2026). It has no idempotency key, and onboarding would rewrite the apex SPF and DKIM records that the runbook set by hand. It is not a candidate now.

### 5. Local and CI test infrastructure

- **Mailpit is in the local and CI stacks.** The web UI and API are on 54324, and SMTP is not exposed to the host (`config.toml:100-106`). The CI stack keeps Mailpit and the edge runtime (`.github/actions/supabase-stack/action.yml:44-54`).
- **Tests already have a helper for reading Mailpit:** `src/test/mailpit.ts` (loopback only, exact address match, polling). E2E wraps it in `e2e/support/mail.ts`.
- **The pattern for proving "no student data" is structural.**
  - The existing tests check: the subject, exactly one URL (and which one), no `<form|<script|<img`, and that exactly one message was sent ([`password-recovery.integration.test.ts:70-82`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/test/password-recovery.integration.test.ts#L70-L82)).
  - The job email can be tested the same way.
- **Mailpit 1.30 has an HTTP send API** (`POST /api/v1/send`, Context7 `/axllent/mailpit`). A Worker running on the host could send to it at `127.0.0.1:54324` (not verified, see below).

### 6. Content available for "the result information" (FR-309)

**Fields that exist:**
- **Job:** `status`, `finished_at - started_at`, `policy.preset`, `stages[]` (tier, status, best, bound, wallClockS, stoppedBy).
- **`result.diagnostics`:** `elapsedMs`, `provenOptimal`, `stopReason`, and per cohort `occupiedSlotsBefore/After` and `unplaced[{courseId, missing}]` (`contracts/generation-wire.schema.json`).
- **Plans:** the source plan's name, and "Proposal — <name>" for the clone (`generation-job.ts:155`).

**Student data:**
- The wire format carries only opaque ids; student keys appear only in `snapshot`.
- `error` is free text written by at least five code paths. It carries course and teacher UUIDs, cell keys, a course's natural key (name, level), and the solver's HTTP body. None of them is a student name, but none of them has been proven safe for email either. **Leave `error` out of the email.**
- Plan names are free text written by authors. That is a small residual (see C12).

## Challenges and options

### C1. Nothing fires with no tab open

Every completion-adjacent action other than the solver's own writes runs inside an editor's request (§1). Something needs a clock.

| Option                                                       | Fires with no tab | Latency          | Notes                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Worker Cron Trigger** (recommended)                    | yes               | ≤ 1 min + grace  | `triggers.crons`, a `scheduled` export. On Paid: 30 s CPU, 15 min wall clock per run. Changes take up to 15 min to propagate. Cron triggers alongside a container Durable Object are a supported combination (`2026-08-20-job-aware-container-lifecycle/research.md:250-253`). |
| (b) Supabase Cron (pg_cron) → pg_net → Edge Function         | yes               | ≤ 1 min          | Runs as `postgres`. Needs two new extensions, Vault secrets set by hand per environment, and a second Edge Function. pg_cron reports success even when the HTTP call failed. Its jobs fire every minute in every local and CI stack.                                                         |
| (c) Database trigger (Database Webhook) on the terminal UPDATE | yes             | seconds          | The trigger runs as `solver_job_writer`, which cannot read Vault, so it would need a second `SECURITY DEFINER`. pg_net does not retry, and its queue is lost on a crash, so a failed send is lost for good. It still needs a poll behind it.                                                  |
| (d) Solver callback to a Worker endpoint                     | yes               | seconds          | It fails exactly when the container dies, and it needs a public route plus caller auth. Rejected before (`drift-decided-delivery/research.md:226-229`).                                                                                                                                     |
| (e) Durable Object `Container.schedule()`                    | prod only         | —                | Bypassed in tier 1, CI and the hosted campaign. Importing the app's layers into the DO is "architecturally backwards". The `@cloudflare/containers` package is deprecated (2026-11-09).                                                                                                     |
| (f) Cloudflare Queues                                        | n/a               | —                | Only useful if the Worker is what notices completion. A database-side producer would need a Cloudflare API token in Vault.                                                                                                                                                                  |

A one-minute poll is cheap next to a 20–38-minute solve. It also gives retries for free: a send that failed is just a row still due on the next tick.

### C2. The notifier has no database identity

**This is the slice's real cost.** Every option bends one recorded rule. The right question is which bend is smallest and best guarded.

| Option                                                                         | Rule it bends                                                                                                                                                                                       | What it costs                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) New `job_notifier` machine role** (recommended, pairs with C1a)          | The token hook's "exact value" allowlist gets a second value. The Worker now **uses** a credential of its own; until now it has been only a courier.                                                  | Hook re-created from the live body. A role with column-scoped SELECT and a one-or-two-column UPDATE, plus `to job_notifier` policies on five tables. The role-matrix filter at `:664`/`:697` generalized to every machine role. A sibling of `solver-credential.integration.test.ts`. `provision-solver-user.mjs` parameterized. A runbook section (rotation, kill switch). CLAUDE.md amended. The drift research already priced this as allowed: *"priced, not forbidden"* (`drift-decided-delivery/research.md:215-216`). |
| (b) Edge Function with the secret key (pairs with C1b)                         | "`admin-users` is the only code that holds the secret key." The solver precedent: a secret key *"cannot be scoped to a table, schema, or role"* (`2026-08-10-solver-contract-and-jobs-schema/research.md:241-289`). | The fewest database changes. But it puts a whole-database credential behind a scheduled endpoint. A second function needs a `[functions.<name>]` block, a named CI deploy step, a Dependabot entry, a CI warm-up, a stack restart, and the first custom function secrets.                                                                                                                                                                                                  |
| (c) The cron's SQL reads everything as `postgres` and posts to a "mail relay" function holding only the Resend key | A new kind of privileged code: plpgsql run by the table owner. A shared secret sits in `net.http_request_queue`, readable by any role that can log in to the database (Supabase KB, 2026). | No machine role and no secret key. But the logic (fences, outcome mapping, reconciling `net._http_response`) lives in plpgsql and can only be tested end to end. A leaked relay secret lets anyone send job emails from our domain to any address.                                                                                                                                                                                                                          |
| (d) A narrow `SECURITY DEFINER` RPC                                            | The one-DEFINER exception gets a second entry.                                                                                                                                                      | Small, but the repo has kept that list at exactly one on purpose.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| (e) Widen `solver_job_writer`                                                  | It puts every staff email within the container's reach.                                                                                                                                             | Rejected: the solver's narrowness is a security property (`solver-credential.integration.test.ts`).                                                                                                                                                                                                                                                                                                                                                                                 |

**Why (a):**
- It is the only option that keeps both "no secret key outside `admin-users`" and "one DEFINER".
- Its privileges are what a reviewer can check with `has_table_privilege`: read-mostly, column-scoped and visible.
- It reuses a pattern with tests, a kill-switch drill and a runbook already written.

**Two details to plan for:**
- **The Worker will sign in once per tick.** That is a password grant every minute from Cloudflare's addresses, so GoTrue's sign-in rate limit needs checking. Caching the token in isolate memory and refreshing it would cut that. The hook also fires on refresh (`user-managment-research/research.md:511`).
- **Never enable Supabase Auth CAPTCHA.** It would break this sign-in as well as the solver's.

### C3. The planned event can't fire, and "succeeded" isn't verified yet

- **Key on the solver's terminal write** (`status` terminal, `finished_at` set), not on delivery.
- **That write comes before the server-side check.** At the author's visit the oracle can still turn the job `failed` ([`generation-delivery.ts:228-239`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L228-L239)).
- **Options:**
  - **(a) Word the email honestly** (recommended): "Generation finished — open the plan to review and apply it." Never "ready" or "verified". This also matches the S-306 framing that the email is the prompt that brings an author back to a decision (`roadmap.md:198`).
  - **(b) Run the oracle in the notifier.** That needs write access and is the retired auto-apply path (FR-307). Rejected.
  - **(c) Email only after delivery.** That never fires on a walk-away. Rejected.

### C4. `notified_at` can't be shared

- **Add `emailed_at`** (and a claim column; see C6) in an additive migration.
- **The emailer never writes `notified_at`.** It reads it only to skip a job the author has already opened.
- **Update the two places that promise a "second writer"** in the same change: [`20260828093000:56-57`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql#L56-L57) (as a note in the new migration, since the old one is not edited) and the `markNotified` docblock at [`generation-delivery.ts:115`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L115). This is the lessons.md rule: a doc that names a mechanism is coupled to it.
- **Also amend** FR-309's re-grounding note (archived PRD) and the roadmap's S-310 unknown, so nothing downstream inherits the old event definition.

### C5. First deploy and outages would flood

- **Every historical terminal row has `emailed_at` null.** The first sweep would email every author about every job they ever ran.
- **Backfill.** Backfill `emailed_at = coalesce(finished_at, updated_at)` for existing terminal rows. The precedent is S-306's `notified_at` backfill (`20260828093000:77-80`), and an `UPDATE` on existing rows is still additive.
- **Lookback window.** Also bound the sweep to `finished_at > now() - interval '24 hours'`. A catch-up after an outage then never mails stale news. The window should not be shorter than the Resend idempotency window.

### C6. Duplicate and lost sends

**Overlapping ticks, timeouts and Worker restarts can each send twice or lose a send.**
- **Recommended:**
  1. Claim with a compare-and-set: `email_claimed_at` is null or older than 5 min, and `emailed_at` is null.
  2. Send with `Idempotency-Key: job-complete/<job id>`.
  3. Stamp `emailed_at` on 2xx.
  4. On failure or timeout, let the claim expire, so the next tick retries.
  - A retry within 24 h with the same key returns the first success (`idempotent-replayed: true`) rather than sending again. The marker in the database covers anything older.
- **Alternative (one column):** claim by stamping `emailed_at` and send once, which is at-most-once. That is simpler, but a failed send is lost.
- **Note:** Resend answers `409 concurrent_idempotent_requests` while the same key is in flight. Treat that as "another tick has it".

### C7. There is no app-level sender

- **Build a Resend HTTP adapter** (`fetch`) with a **new** API key: `sending_access`, restricted to `ib-timetable-planner.dev`, named for the notifier. The 2026-10-10 plan called it `worker-notify`.
- **Store it as a Worker secret** and type it in `src/cloudflare-env.d.ts`, never through `wrangler types`.
- **Keep it separate from the SMTP key.** Resend's guidance is one key per service, so each can be revoked alone and its logs read alone.
- **Reject the alternatives:**
  - Raw SMTP from the Worker.
  - The Send Email Hook (it would take over every Auth email).
  - Cloudflare Email Service, which is beta (§4).

### C8. Testing locally and in CI

**The constraints:**
- CI must not call Resend.
- Cron triggers do not fire under `pnpm preview`. Wrangler 4.130 exposes `/__scheduled` only with `--test-scheduled`.
- The Worker reads its env from `.dev.vars`, which is snapshotted at build time (the lessons.md rule about `.dev.vars`).

**Recommended split:**
- **A transport port, two adapters:** `resend` in production, and `mailpit` (Mailpit's `POST /api/v1/send`) locally and in CI. Choose by explicit config, never by sniffing the host; the Turnstile test-key rule is the precedent for refusing a test transport off loopback.
- **Pure logic under Vitest:** eligibility (fences, outcomes, self-stop), the outcome-to-copy mapping, and building the content. These belong in `model/`.
- **One integration suite that calls `sweepJobEmails` directly:**
  - with a signed-in `job_notifier` client (from a new factory) and the Mailpit transport;
  - it asserts the subject, exactly one URL to `/plans/<id>`, no `<form|<script|<img`, no `error` text, one message per job, and nothing sent to fenced principals;
  - a second sweep sends nothing.
- **No E2E spec.** No browser is in the path.
- **Integration lane:** the integration lane already runs ~1 in 5 red when it runs in parallel. The new suite should be safe to run in parallel (scoped to its own jobs, cleaned up through `teardown`).

### C9. Shared 100/day Resend quota

- **Expected volume is low.** `max_instances: 1` and 20–38-minute solves allow at most ~40–70 jobs a day in theory, and a handful in practice.
- **The risk is a bad day.** Job emails could spend the budget that password resets and invitations need. Reaching the cap fails every send until midnight UTC.
- **Options:**
  - **(a) An app-side daily cap** for job emails (e.g. ≤ 20 per UTC day, counted from `emailed_at`). Past the cap, the sweep marks jobs skipped (recommended).
  - **(b) Move to Resend Pro.** The runbook's named fallback.
  - **(c) Accept the risk.**
- **Whichever is chosen:** treat `429 daily_quota_exceeded` as "stop this tick", never as a reason to retry in a hot loop.

### C10. Which outcomes send, including a dead container

| Outcome                                  | Send? (recommended)       | Why                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `succeeded`                              | yes                       | A decision is waiting                                                                                                                                                                                                                                     |
| `stopped`, by the requester              | no                        | They pressed Stop and are watching                                                                                                                                                                                                                        |
| `stopped`, by someone else (an admin)    | yes                       | They didn't know. With stop & keep, the result may still be there                                                                                                                                                                                         |
| `interrupted` (SIGTERM, a deploy)        | yes                       | It may carry a checkpoint, and the author needs to know either way                                                                                                                                                                                         |
| `failed`                                 | yes, without `error` text | "It didn't finish — open the plan"                                                                                                                                                                                                                        |
| Dead container: the row stays `running`, heartbeat stale | **decide**                | A read-only notifier can't reclaim the row. Options: (a) skip in v1, and the next editor visit reclaims it; (b) email "stalled" when `isStaleActiveJob` and stamp `emailed_at`, so the later reclaim doesn't email again. (b) is cheap and covers exactly the walk-away case. |

- **Grace period:** send only when `finished_at < now() - 2 min` and `notified_at` is null. An author watching the pending-proposal page is delivered within ~5 s, which stamps `notified_at`, so they don't also get an email.

### C11. Recipient fences and edge cases

| Case                                                         | Recommended                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `requested_by` null (from before S-407, or the account deleted) | Skip, recorded as "no recipient"                                                               |
| Deactivated (`user_roles.deactivated_at`), including a ban made in the app | Skip                                                                               |
| Pending (`user_directory.must_change_password`)              | Skip (they can't open the link anyway)                                                            |
| No `user_roles` row                                          | Skip                                                                                              |
| Demoted to viewer since pressing Generate                    | Send. A viewer reads everything and sees "Finished — waiting for an author"; the copy can say so |
| Ban made in the dashboard (no `banned_at` or `deactivated_at`) | Accept the residual. The email carries no student data and links to an app they cannot reach   |
| Email changed since Generate                                 | Use the current `user_directory.email` (S-411's mirror follows the address)                       |

- **The notifier cannot call `current_app_role()` for another user.** It has to apply the same predicate itself: a role row that is not deactivated, and no `must_change_password`.
- **Pin it against drift:** test it against the role matrix's `pendingAdmin` and `deactivatedAdmin` principals, not just by reading the function. Any change to the fences re-creates functions from the latest live body (lessons.md).

### C12. Content: no student data, one link, an origin

**Include:**
- The plan's name.
- The outcome, in wording from C3 and C10.
- How long it took.
- The policy label.
- At most counts ("all courses placed" or "N course groups could not be placed"). **No names, and no `error` text.**

**Shape:**
- **Exactly one link**, to `/plans/<proposal id>`, or to `/plans/<source id>` for a failure or a missing clone.
- **No tracking, images, forms or scripts.** Send plain text alongside HTML.
- **"IB Planner" in the subject**, matching the sender name. These are the S-402/S-410 template rules (`supabase/templates/invite.html:8-15`).

**Origin:** the Worker has no configured origin today (no `site` in `astro.config.mjs`, no `SITE_URL`), and a cron has no request to take one from. Add a non-secret `APP_ORIGIN`: `wrangler.jsonc` `vars` in production, and `.dev.vars` locally before the build.

**Residual:** plan names are free text, so an author could type a student's name into one. Either accept and record that (staff wrote it, and it is plan information), or leave the name out and let the link carry the identity.

### C13. School inbox delivery isn't proven

- **What has been tested:** sender authentication passed in Gmail (`forgot-password-by-email/smoke.md:9-15`).
- **What is still open:**
  - The M365 smoke test (`smoke.md:76-98`), and S-410's done-line demo 6.5 is still owed.
  - DMARC is still `p=none`.
- **A finding from the invites:** an invitation landed in Gmail's Promotions tab.
- **The job email will look less transactional than a reset.**
- **Recommendation:**
  - Keep it plain.
  - Run the house rule in spirit: one real job email to a school mailbox, recorded in this change's hosted check before the slice is called done.
  - If the M365 test is run then, it also closes S-402's and S-410's debt.

### C14. Worker entry and tooling gaps

- **`src/worker.ts:26`** becomes `export default { fetch: handle, scheduled }`. `ExportedHandler` in `src/cloudflare-env.d.ts:81-83` models only `fetch` and must be widened by hand (never `wrangler types`).
- **`@astrojs/cloudflare` (14.3.1)** documents a custom entry with `queue` but not `scheduled`. A build has to prove that `scheduled` survives the bundle.
- **Inside `scheduled`, read config from the handler's `env` argument**, not `astro:env/server`, whose initialization outside a request is unverified.
- **FSD placement:**
  - The handler stays a top-level file beside `worker.ts`, outside steiger's layers, like `solver-container.ts`.
  - The sweep's pure model goes in `src/entities/timetable/model/generation/` next to `job-status.ts` and `job-staleness.ts`.
  - The Resend and Mailpit transport goes in `src/shared/api/`.
- **Deprecation, not S-310 scope:** `@cloudflare/containers` is deprecated in favour of `ctx.container` (Cloudflare docs, updated 2026-11-09). That deserves its own issue. It is one more reason not to hang the notifier on `SolverContainer`.

### C15. Hosted rollout order

**On merge, CI pushes the migration first, then deploys the Worker with its cron.** Hand-made steps then need to follow:
- provision the hosted `job_notifier` user (only after the hook migration is live);
- `wrangler secret put` for `NOTIFIER_MACHINE_PASSWORD` and `RESEND_API_KEY`;
- set `APP_ORIGIN`;
- create the Resend key.

**Until the secrets exist, the cron must fail closed and quietly:** a missing secret means log once and no-op, never a crash loop.

**The emails go out live.** Thanks to C5's backfill, the first live email is for the first job finished after deploy.

**The "no merge to `main` mid-solve" rule applies as usual.**

**Document:**
- the provisioning, rotation and kill switch in a runbook section beside `solver-credential.md`;
- the README's secrets table;
- the CLAUDE.md amendments (hook allowlist, the Worker's own credential, `emailed_at` and `notified_at` semantics).

## Option comparison (trigger × identity)

| Option                                                         | Clock         | Identity                               | Rules bent                                                       | New infrastructure                                                                                  | Retries                                     | Testability                                                                      |
| -------------------------------------------------------------- | ------------- | -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| **T1 Worker Cron + `job_notifier`** (recommended)              | Cloudflare cron, 1 min | Machine user through the token hook | Hook allowlist +1; the Worker uses its own credential          | `scheduled` export, 2 secrets + 1 var, role and policies                                            | Re-scan + idempotency key                   | TypeScript: Vitest plus one integration suite through Mailpit                    |
| T2 Supabase Cron → Edge Function with the secret key           | pg_cron       | Secret key in a second function        | "Only `admin-users` holds the secret key"; the solver precedent | pg_cron, pg_net, Vault (by hand per environment), a function with its deploy step, Dependabot entry and warm-up, function secrets | Re-scan + idempotency key        | Deno tests plus integration; pg_net reaching the function in CI unverified       |
| T2′ Supabase Cron → Edge Function as `job_notifier`            | pg_cron       | Machine user                           | Hook allowlist +1                                                | T2's infrastructure plus T1's role                                                                  | Re-scan + idempotency key                   | As T2                                                                            |
| T3 Supabase Cron with SQL as `postgres` → mail relay           | pg_cron       | Table owner, inside the database       | Privileged plpgsql; a relay secret in the pg_net queue          | pg_cron, pg_net, Vault, relay function                                                              | Reconcile `net._http_response`              | plpgsql-heavy, integration only                                                  |
| T4 Database Webhook trigger                                    | Row trigger   | DEFINER (to read Vault)                | A second DEFINER                                                 | pg_net, Vault, function                                                                             | None: at-most-once, queue lost on a crash   | Hard                                                                             |
| T5 Solver callback, DO `schedule()`, Queues                    | —             | —                                      | —                                                                | —                                                                                                   | —                                           | Rejected (C1)                                                                    |

## Decisions needed (before `/10x-plan`)

1. **Trigger and identity:** T1 (recommended) or T2. Everything else follows from this.
2. **Outcomes that send:** confirm C10's table. Decide on the "stalled" email, which is cheap and covers the walk-away case exactly.
3. **Content:** whether to include the plan name (the residual in C12), and whether to include counts of unplaced course groups.
4. **Quota:** an app-side daily cap (recommended), or Resend Pro.
5. **Per-user opt-out:** none in v1 (recommended). FR-309 doesn't ask for one, and volume is tiny. If wanted later, it is a `profiles` column and a toggle on `/account`.
6. **The event definition:** amend FR-309's re-grounding note, the roadmap's S-310 unknown, and the `notified_at` "second writer" comments to the terminal-write event and `emailed_at` (C4).

## Suggested phasing (input for `/10x-plan`, assuming T1)

1. **Database and identity:**
   - An additive migration: `emailed_at` and `email_claimed_at`, the backfill, the `job_notifier` role with column grants and `to job_notifier` policies, and the hook allowlist re-created from the live body.
   - The role-matrix filter generalized.
   - A `job-notifier-credential.integration.test.ts` (role claim, exact column lists, no BYPASSRLS, nothing table-wide).
   - `pnpm db:types`.
   - An access-control diff shown red first (CLAUDE.md).
2. **Provisioning and docs:** `provision-solver-user.mjs` parameterized (or a sibling script), a runbook section (rotation, kill switch), and the CLAUDE.md amendments.
3. **Sender:** the transport port with Resend and Mailpit adapters, and the content builder (pure, unit-tested) under the structural "one link" rule.
4. **Sweep:** eligibility and outcome mapping (pure), then claim, send and stamp (api). An integration suite through Mailpit, covering the fenced principals and idempotence across two sweeps.
5. **Worker wiring:**
   - the `scheduled` export, `triggers.crons`, the env types, `APP_ORIGIN`;
   - a build check that the handler survives;
   - a local `/__scheduled` smoke run;
   - the README's secrets table.
6. **Hosted:** provision the user, set the secrets, send one real job email to a school mailbox (M365), and record it in `hosted-check.md`.

## Code References

- [`src/_pages/plan-detail/api/generation-delivery.ts:70-77`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L70-L77): "no cron, and a `scheduled` handler has no database identity here"
- [`src/_pages/plan-detail/api/generation-delivery.ts:100-139`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L100-L139): `markNotified`, the only writer of `notified_at`, plus the "second writer" note
- [`src/_pages/plan-detail/api/generation-delivery.ts:228-239`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plan-detail/api/generation-delivery.ts#L228-L239): the oracle turning `succeeded` into `failed` at delivery
- [`src/_pages/plans-list/api/generation-status.ts:93-99`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/api/generation-status.ts#L93-L99): the hub's discovery filter, which reads `notified_at`
- [`src/_pages/plans-list/model/generation-toasts.ts:34`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/_pages/plans-list/model/generation-toasts.ts#L34): in-app announcements (FR-309's in-app half)
- [`src/entities/timetable/model/generation/job-staleness.ts:23-57`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/entities/timetable/model/generation/job-staleness.ts#L23-L57): `HEARTBEAT_GRACE_MS`, `isStaleActiveJob`
- [`src/shared/api/supabase.ts:7-53`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/shared/api/supabase.ts#L7-L53): the cookie-bound and sessionless (anon) clients
- [`src/worker.ts:26`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/worker.ts#L26): `export default { fetch: handle }`, with no `scheduled`
- [`src/solver-container.ts:38, 85-99`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/solver-container.ts#L85-L99): `sleepAfter`, `onActivityExpired` (counts active solves only)
- [`services/solver/src/cpsat_service/supabase.py:236-257`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/services/solver/src/cpsat_service/supabase.py#L236-L257): the solver's terminal write (`status`, `finished_at`)
- [`supabase/migrations/20260810200122_generation_jobs.sql:57-129`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260810200122_generation_jobs.sql#L57-L129): the table, statuses, `notified_at`, the anon revoke
- [`supabase/migrations/20260810200934_custom_access_token_hook.sql:37-55`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260810200934_custom_access_token_hook.sql#L37-L55): the exact-value allowlist
- [`supabase/migrations/20260812141459_solver_select_column_scope.sql:71-72`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260812141459_solver_select_column_scope.sql#L71-L72): the column-scoped SELECT pattern to copy
- [`supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql:50-80`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20260828093000_proposal_pending_and_delivery_vocabulary.sql#L50-L80): the `notified_at` semantics and backfill precedent
- [`supabase/migrations/20261105073614_user_directory.sql:74-76`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20261105073614_user_directory.sql#L74-L76): who may read an email address
- [`supabase/migrations/20261106192749_created_by_and_job_ownership.sql:127-224`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/supabase/migrations/20261106192749_created_by_and_job_ownership.sql#L127-L224): `requested_by`, the guard trigger
- [`src/test/role-matrix.integration.test.ts:664, 697`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/test/role-matrix.integration.test.ts#L664): structural filters hard-coding `solver_job_writer`
- [`src/test/password-recovery.integration.test.ts:70-82`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/src/test/password-recovery.integration.test.ts#L70-L82): the structural email-content test pattern
- `src/test/mailpit.ts`: the Mailpit reader the integration suite reuses
- `src/test/solver-credential.integration.test.ts`: the credential guard suite to mirror for `job_notifier`
- `scripts/provision-solver-user.mjs:25-26`: the hard-coded machine role and email to parameterize
- [`docs/runbooks/email-delivery.md:8-80`](https://github.com/dobrek/ib-timetable-planner/blob/2d2af4743c8198dac452e4625d9938a5094a1049/docs/runbooks/email-delivery.md#L8-L80): the Resend setup, sender, SMTP key's location, shared cap

## Architecture Insights

- **The Worker is deliberately identity-less outside a request.** Every privileged database actor so far is either a person's session or the solver's narrow machine role. S-310 is the first feature that needs the Worker to act on its own behalf. Recording that as a decision matters as much as the code: "the Worker holds no secret key" stays true; "the Worker never authenticates as itself" stops being true.
- **The jobs table is the only status channel,** so the notifier is a reader of state transitions, not a subscriber to events. A poll with a marker column is the natural shape here. It is also what makes retries free, which a push (trigger, callback) does not give without a poll behind it anyway.
- **Machine principals are kept out of the human access model on purpose.** They hold no `user_roles` row, sit outside `CAPABILITY_POLICIES`, are hidden from the directory, and have their own credential suite. A second machine role should generalize those exclusions rather than add `job_notifier` beside `solver_job_writer` everywhere the solver is special-cased.
- **Every product email follows a structural safety contract:** one link on our domain, no tracking, images, forms or scripts, and the "no student data" rule. Tests assert the shape, not the absence of names. Job email should join that contract, not invent its own.

## Historical Context (from prior changes)

- `context/foundation/archive/2026-10-10-prd.md:520-549`: FR-309. Email joined the requirement in the Socrates review. The S-306 re-grounding defined the event as a durable row transition and named S-310's emailer the second writer of `notified_at`. Both points are revised by C3 and C4.
- `context/archive/2026-08-25-drift-decided-delivery/research.md:61-84, 191-234`: "the blocker is identity, not scheduling". Options A–E were costed for *delivery*. A second machine principal is "priced, not forbidden". A solver callback "breaks exactly when the container dies". "S-310 is unsatisfiable under the weak reading."
- `context/archive/2026-08-25-drift-decided-delivery/frame.md:91-95`: once auto-apply was retired, "only S-310's read-only notifier clock remains".
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md:243-293`, `plan.md:83-84, 127`: a Cron Trigger was rejected *for stale-job recovery* because it has no identity, and visit-time reclaim was chosen instead. That doesn't forbid a cron for S-310. "Do not override `alarm()`".
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md:241-289`: credential options A–F. A machine user, hook and narrow role (E) was chosen. A secret key "cannot be scoped". A Worker-minted JWT "puts a forge-anything secret in the Worker".
- `context/changes/user-managment-research/research.md:569-625`: Resend was decided 2026-10-10 and "shared with S-310". A separate key `worker-notify` goes in via `wrangler secret put` (`:600`). Cloudflare Email Service is "watch, revisit at GA".
- `context/archive/2026-10-19-forgot-password-by-email/`: the apex domain, the `team@` sender, `p=none`, the 100/day cap, and the deferred M365 smoke test.
- `context/archive/2026-11-10-invite-by-email/research.md:387`: "Throttling has to be ours… S-310 will meet the same constraint."
- `context/archive/2026-11-06-created-by-and-job-ownership/`: `requested_by` is a first-class fact for S-310; a null means "nobody to email".
- `context/archive/2026-08-31-extract-share-polling-store/research.md:166-170`: reusing `notified_at` for another consumer was rejected, because it clears on the first view.

## Related Research

- `context/archive/2026-08-25-drift-decided-delivery/research.md`: trigger and identity options for headless delivery (the closest prior pricing).
- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md`: Cron Triggers, the DO lifecycle, stale-job recovery.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md`: machine-credential options.
- `context/changes/user-managment-research/research.md`: the email provider decision.
- `context/archive/2026-11-10-invite-by-email/research.md`: the shared quota and email content contract.

## Not verified

- **`scheduled` beside Astro's `handle`.** That `export default { fetch: handle, scheduled }` survives the `@astrojs/cloudflare` 14.3.1 build, and that the cron fires on the deployed Worker. The adapter documents `queue` this way, not `scheduled`.
- **Config inside `scheduled`.** Whether `astro:env/server` resolves there. The design avoids depending on it.
- **Mailpit's send API locally and in CI.** That `POST /api/v1/send` is enabled in the CLI-managed Mailpit and reachable at `127.0.0.1:54324` from the preview and the integration runner.
- **Sign-in rate limit.** GoTrue's hosted sign-in rate limit for a once-a-minute password grant from Cloudflare addresses, and whether a cached token plus the refresh grant is needed.
- **For T2/T3 only:**
  - whether pg_net in the trimmed CI stack can reach the edge runtime (`api.supabase.internal:8000` vs `host.docker.internal`);
  - that `[db.vault]` must stay out of `config.toml`, because `supabase db push` would upsert local values onto hosted (CLI issue #3815).
- **Cloudflare Email Service** was still beta per the docs read on 2026-11-16. No GA entry was found.
- **No live probe was run** for this research. Every claim is from code, recorded decisions or current docs.
