<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Job-completion email (S-310)

- **Plan**: context/changes/job-completion-email/plan.md
- **Mode**: Deep
- **Date**: 2026-11-16
- **Verdict**: REVISE (SOUND after the triage fixes)
- **Findings**: 1 critical, 5 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | WARNING |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | FAIL    |
| Plan Completeness     | WARNING |

## Grounding

29/29 paths ✓. Symbols 7/8 ✓: the hook and guard bodies are live, `isStaleActiveJob`, `isTerminalJobStatus` and `policyLabel` exist, `/cdn-cgi/local/scheduled` is real, and `@cloudflare/vite-plugin` passes the default export through. One ✗: `access-claims.ts` is already `machine_role?: string`. Brief↔plan ✓. Progress↔Phase ✓. Success Criteria checkboxes follow the repo's recorded preference.

Dismissed during verification: "banned requesters aren't fenced". An app ban sets `user_roles.deactivated_at` (`20261113123108_account_ban.sql:12-13`), which the plan already fences.

## Findings

### F1 — The notifier's own SELECT policy refuses its stamp

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (row scope), §3 (policies); Phase 4 §2
- **Detail**: The planned SELECT policy was `using (email_requested and emailed_at is null)`. PostgREST's UPDATE always carries a RETURNING, and Postgres checks the NEW row against SELECT policies, so every settle write (setting `emailed_at`) would fail 42501. The repo measured exactly this for the solver (`20260812141459_solver_select_column_scope.sql:16-29`).
- **Fix A ⭐ Recommended**: generation_jobs SELECT `using (email_requested)`, with the narrowing in the column grants (the solver's measured shape). UPDATE USING keeps `emailed_at is null`, and the lookup-table policies still key on unsettled jobs.
  - Strength: Proven shape; no clock in a policy; addresses stay narrow.
  - Tradeoff: A leaked credential reads the granted columns of every opted-in job, not only due ones.
  - Confidence: HIGH — measured live in 20260812141459.
  - Blind spot: None significant.
- **Fix B**: SELECT admits settled rows for one hour after `emailed_at`.
  - Strength: Settled rows drop out of view.
  - Tradeoff: Time-dependent policy keyed on a value the notifier writes.
  - Confidence: MED — unmeasured.
  - Blind spot: Not measured against the live stack.
- **Decision**: FIXED (Fix A)

### F2 — Editors can still write the three email marker columns

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2–§3 (guard)
- **Detail**: `authenticated` holds table-wide UPDATE on `generation_jobs` (`20260617171048:14-16`). The plan froze only `email_requested`, so an editor could silence someone's email or re-arm a job.
- **Fix**: The guard forces the three markers to null at a signed-in insert and refuses a change to any of the four email columns. Its trigger list gains all four.
- **Decision**: FIXED

### F3 — The checkbox promises an email while the notifier is off

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §1; Phase 6 (rollout window, kill switch)
- **Detail**: The ticked checkbox showed whatever the config, including during the hosted rollout window and after the kill switch. No "capability configured" prop existed; the precedent is `forgot.astro:8-14`.
- **Fix A ⭐ Recommended**: One shared `readJobEmailConfig` in `src/entities/timetable/api/job-email-config.ts`, used by both the route and the cron. The route computes `jobEmailAvailable` and threads it to `GenerateButton`, and the checkbox is absent when it is false.
  - Strength: The UI never promises what the system won't do; follows existing precedents.
  - Tradeoff: One more prop through three components; the check is presence only.
  - Confidence: HIGH.
  - Blind spot: The server does not re-check (a crafted call opts in only the caller's own job).
- **Fix B**: Always show the box and document the gap.
- **Decision**: FIXED (Fix A)

### F4 — The new shared mail code would fail steiger and copy existing helpers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §4, Phase 5 §2
- **Detail**: A deep import of `@/shared/api/mail` from `entities` is a steiger "forbidden sidestep". The loopback check would have been a fifth copy, and `timeBoundedFetch` already exists.
- **Fix**: Re-export through `@/shared/api`, add `src/shared/lib/loopback-host/` (shared with Turnstile), and reuse `timeBoundedFetch`.
- **Decision**: FIXED

### F5 — The global sweep will settle other suites' fixtures in the parallel lane

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1, Phase 4 §3–§4
- **Detail**: Under `--maxWorkers=2` the sweep would stamp the credential suite's unsettled fixtures. Neither suite had a notifier-user factory.
- **Fix**: The credential suite's unsettled fixtures are `running` with a fresh heartbeat, and its settled ones are stamped by the service role. A new `createSignedInMachineUser(admin, "job_notifier")` factory uses a unique email per call.
- **Decision**: FIXED

### F6 — "Revoke the key in Resend" is not a quiet kill switch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4, Phase 6 §1
- **Detail**: With the key revoked, every 401/403 was a per-job `failed`, re-sent every 5 minutes for 24 h.
- **Fix**: Map 401/403 to `stop-tick(credential)`. The runbook names `wrangler secret delete RESEND_API_KEY` as the one quiet off switch, which also hides the checkbox.
- **Decision**: FIXED

### F7 — Small contract inaccuracies to correct before implementing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4, §7; Phase 3 §1–§2; Phase 4 §2; Phase 5 §1
- **Detail**: Five lines were wrong or incomplete:
  - `access-claims.ts` needed no widening.
  - The role filter needs set containment, not array inequality.
  - `policyLabel` needs `parseStoredPolicy` first.
  - The `config.toml` hook comment is coupled to the mechanism.
  - The decision needed a two-stage contract.
- **Fix**: Amended in place. A `token_refresh` note now sits beside the grant.
- **Decision**: FIXED

### F8 — Two verification steps prove less than they claim

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.1, Phase 5 criterion 5.5
- **Detail**: The guard's red would have been "column missing", and `grep scheduled` matches anything in the bundle.
- **Fix**: The guard's red is recorded with the columns applied and the guard change held back. 5.5 greps the cron module's log tag, and the export is proven by 5.6's `/cdn-cgi/local/scheduled` smoke.
- **Decision**: FIXED
