# Job-completion email (S-310) — Plan Brief

> Full plan: `context/changes/job-completion-email/plan.md`
> Research: `context/changes/job-completion-email/research.md`

## What & Why

An author who presses Generate and walks away during a 20–38-minute solve currently learns the result only by coming back to the app. S-310 adds an opt-in email ("Email me when it finishes", ticked by default) that tells the requester how the job ended and links to the plan, with no browser open. It completes FR-309, whose in-app half shipped in S-306, under the PRD's rule that no email carries student data.

## Starting Point

Only the solver's terminal write happens without a browser. Delivery, stale-job reclaim and `notified_at` all run inside an editor's request. The Worker has no database identity outside a request, the token hook maps one machine role (`solver_job_writer`), and no app code sends mail; all mail today is GoTrue → SMTP → Resend.

## Desired End State

The Generate dialog carries a ticked "Email me when it finishes" checkbox, shown only while the notifier is configured and fixed once the job starts. Within about a minute of an opted-in job finishing, failing, being interrupted, being stopped by an admin, or stalling, its requester gets exactly one plain email. It names the plan, outcome, duration and policy, gives a count of unplaced course groups, and has one link. A cron in the Worker does this as a narrow `job_notifier` machine user that can never read `error` or `snapshot`, and sees a person's address only while they have an email due.

## Key Decisions Made

| Decision            | Choice                                                                    | Why (1 sentence)                                                                                          | Source   |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| Clock + identity    | Worker Cron Trigger (every minute) + new `job_notifier` machine role      | Keeps "no secret key outside `admin-users`" and "one DEFINER", and reuses the solver's tested pattern     | Research |
| Who gets an email   | Per-job opt-in checkbox at Generate, ticked on every open, frozen after   | The author decides; it replaces an unreliable dedupe against in-app views; old rows default to no email   | Plan     |
| Dead container      | One "stopped responding" email once the heartbeat is stale; one per job  | Covers the walk-away case exactly; the link's visit triggers the existing reclaim                          | Plan     |
| Self-stop           | No email when the requester stopped it; an admin's stop still emails      | They were on the page when it ended                                                                        | Plan     |
| Quota               | No app cap; a Resend 429 ends the tick and the email retries later        | Volume is a handful a day; accepted risk on the shared 100/day                                             | Plan     |
| Content             | Plan name, outcome, duration, policy, unplaced count; never `error` text  | Answers "do I go back now?" from the inbox; `error` holds ids                                              | Plan     |
| Notifier read scope | Column grants + rows only for requesters of jobs with an email due        | A leaked notifier password exposes a handful of addresses, not the staff directory                         | Plan     |
| Event and marker    | Solver terminal write or stale heartbeat; own `emailed_at`/`email_outcome` | Delivery never fires on a walk-away, and `notified_at` is the badge's marker                               | Research |
| Duplicates          | CAS claim + `Idempotency-Key: job-email/<id>` + stamp on success          | Overlapping ticks and retries never double-send; a failed send just stays due                              | Research |
| Transport           | Resend HTTP (own sending-only key) in prod; Mailpit HTTP locally and in CI | CI never calls Resend; explicit config, never host sniffing                                                | Research |
| Hosted done-line    | One real hosted job email received in Gmail, recorded                     | Proves the live path end to end; M365 stays S-402/S-410's debt                                             | Plan     |

## Scope

**In scope:**
- An additive migration: four job columns, the `job_notifier` role, grants and policies, the token hook mapping two roles, and the guard freezing the opt-in.
- The Generate checkbox and its launch chain.
- The pure decision and content model, plus Resend and Mailpit transports.
- The sweep, and the Worker's `scheduled` entry and cron.
- Provisioning, the runbook, and README/CLAUDE.md/FR-309 corrections.
- The hosted rollout and one Gmail check.

**Out of scope:**
- A per-user email preference, or changing the choice after launch.
- An app-side cap.
- Deduplicating against in-app views.
- Running the oracle or reclaiming rows from the notifier.
- A second email after a stall.
- pg_cron, pg_net, Vault, or a new Edge Function.
- The M365 check, and an E2E spec.

## Architecture / Approach

The job row is the only status channel, so the notifier is a poll, not a subscriber. Each minute, `scheduled` in `src/worker.ts` reads its env. If anything is missing, it logs "disabled" once and returns. Otherwise it signs in as `job_notifier` (reusing the isolate's session), picks Resend or Mailpit, and calls `sweepJobEmails`.

The sweep:
1. Reads opted-in, unsettled jobs.
2. Runs the pure `decideJobEmail` (wait, skip with a reason, or send a kind).
3. Looks up the recipient's fences and the plan name only for jobs that aren't waiting.
4. Claims with a compare-and-set.
5. Sends with an idempotency key.
6. Stamps `emailed_at` and `email_outcome`.

RLS gives the notifier the same narrow view as that query.

## Phases at a Glance

| Phase                                   | What it delivers                                                     | Key risk                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Database and notifier identity       | Columns, role, grants, policies, hook, guard, suites, provisioning   | Re-creating the hook and guard from anything but their live bodies       |
| 2. Opt-in at Generate                   | The checkbox, threaded to `email_requested`                          | Breaking existing launch tests and callers (default false guards them)   |
| 3. Email decision, content and transport | Pure decision and content, Resend and Mailpit adapters               | A body that varies between retries (Resend 409); unescaped plan names    |
| 4. The sweep                            | Claim, send, stamp, proven through Mailpit under the real role       | Parallel test sweeps double-sending (the claim prevents it)              |
| 5. Worker cron wiring                   | `scheduled` export, cron, env types, quiet-when-unconfigured         | The cron silently lost in the build (checked against `dist/`)            |
| 6. Runbook, docs and hosted rollout     | Runbook, doc corrections, hosted secrets, one Gmail email            | The cron firing before its user and secrets exist (it no-ops by design)  |

**Prerequisites:** S-402 and S-407 done. Local Supabase stack with Mailpit. A Resend account to mint a new sending-only key. Hosted secret-key access for provisioning. No production solve running at merge.
**Estimated effort:** ~4–5 sessions across 6 phases. Phase 1 is the heaviest.

## Open Risks & Assumptions

- Mailpit's send API is assumed open on the CLI-managed stack (docs and the binary say so). Phase 4 probes it before relying on it.
- The per-minute password grant shares GoTrue's per-IP `token_refresh` bucket with human sessions from the same Cloudflare egress IP. At about 3% of the bucket this is assumed safe; a 429 only skips a tick.
- Resend's shared 100/day cap: a burst of job emails could delay a password reset until midnight UTC. This is an accepted risk; Resend Pro is the named fallback.
- Plan names are author-written free text and appear in the email. This residual is recorded, not prevented.
- A stalled email is final, even in the rare case where the job recovers and later succeeds.

## Success Criteria (Summary)

- An author who ticked the box and walked away gets one email per job, from finish, failure, interruption, an admin's stop or a stall, with a working link and no student data or error text.
- Nobody is emailed about a job they didn't opt into, stopped themselves, or can no longer reach (fenced, pending, deleted), and no job is emailed twice.
- One real hosted email has arrived in Gmail with SPF and DKIM passing, and is recorded in `hosted-check.md`.
