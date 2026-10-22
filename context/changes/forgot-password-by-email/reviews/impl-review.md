<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Forgot Password by Email (S-402)

- **Plan**: context/changes/forgot-password-by-email/plan.md
- **Scope**: Phases 1–4 of 5 (full plan; Phase 5 partly done — 5.1/5.2 checked, 5.3/5.4 pending), plus the post-merge fix 2e36c1d
- **Date**: 2026-10-22
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 6 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated evidence (2026-10-22, this review): `astro sync` → `pnpm check` (0 errors) → `pnpm lint` → `pnpm steiger` (clean) → `pnpm test` (228 files / 2211 tests) → `pnpm build` (postbuild: 42 files in `dist/client`, no Supabase key or host) → `prettier --check` on the Phase 4 doc set: all green. `pnpm test:integration src/test/password-recovery.integration.test.ts`: 6/6. `pnpm audit --audit-level=high`: **exit 1** (F6, unrelated to S-402). E2E and the whole integration lane were not re-run.

## Findings

### F1 — The hosted gate ran after the merge, and production sent a scanner-spendable link

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: plan.md:199-203 (Critical Implementation Details), Progress 4.4–4.6; `docs/runbooks/hosted-auth-settings.md:178`; `smoke.md:23`
- **Detail**: The plan made "hosted before merge" a hard ordering: rows 4.3–4.5 had to be checked before 4.6, because the default template uses `{{ .ConfirmationURL }}` and the neutral answer would hide it. On main at merge (9d67d2b, 13:51 UTC), 4.4 and 4.5 were still `[ ]`. The "Last verified" row says the read-back happened "right after the S-402 merge, before its deploy finished". The predicted hazard then happened: production email 1 (14:03 UTC) carried Supabase's default GET-spent link, and email 2 had a `//auth/confirm` link. Both were fixed by about 14:35, and smoke.md and the runbook record the lessons ("a read-back proves what was stored, not what the next email looks like"). Neither plan.md nor change.md says the ordering rule was broken. The deeper gap is a flaw in the plan itself: its gate had no step to send a real email **before** the merge. That was possible, through the dashboard's "Send password recovery" or a `/recover` call from a dev machine, and it would have caught failure 1. S-410 (`invite`) and S-411 (`email_change`) bring new templates and will hit the same ordering again.
- **Fix**: Add an addendum to change.md (and a note on Progress 4.6) recording that the gate ran after the merge and that ~30 minutes of production resets carried the default template. Then capture the rule as a lesson: a hosted email-template change is proven by a real email, sent before merging the code that depends on it.
  - Strength: The process gap is real and comes back in S-410/S-411. The runbook already holds the mechanics, but nothing makes the next plan order them before the merge.
  - Tradeoff: Doc-only; no code change. The record admits a production lapse that has already been fixed.
  - Confidence: HIGH — the timestamps in smoke.md, the runbook's own "after the merge" wording, and the Progress rows at 9d67d2b all agree.
  - Blind spot: Whether the template PATCH was sent before the merge and simply had not propagated ("had not reached the GoTrue that sent it"). Either way the pre-merge proof was missing.
- **Decision**: FIXED — addendum in change.md Notes ("Gate ordering broken") and a suffix on Progress 4.6; no lesson recorded

### F2 — `?saved=` is looked up on a plain object, so prototype keys crash or garble `/account`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/account/ui/AccountPage.astro:17-21 (post-merge 2e36c1d)
- **Detail**: `SAVED_MESSAGES[saved]` resolves inherited keys, and Astro calls any function it is given as a child (`astro/dist/runtime/server/render/any.js:29`). Reproduced in Node:
  - `/account?saved=valueOf` and `?saved=hasOwnProperty` throw "Cannot convert undefined or null to object", so the page returns 500.
  - `?saved=toString` and `?saved=constructor` render "[object Undefined]" and "[object Object]" in the green status line.

  This is not XSS, but anyone can send a signed-in colleague a link that breaks their account page. The previous `saved === "name"` was safe. `reset-outcome.ts:44` (`OUTCOME_BY_CODE[error.code ?? ""]`) has the same shape, but its key is GoTrue's own error code, which is trusted.
- **Fix**: Guard the lookup with `Object.hasOwn(SAVED_MESSAGES, saved)`, or with a `"name" | "password"` type guard built with `.some()`, the idiom `isForgotAlert` and `isEmailLinkType` already use in this change.
- **Decision**: FIXED — `Object.hasOwn` guard in `AccountPage.astro`; `pnpm check`, prettier and eslint clean

### F3 — Post-merge password confirmation: `form.reset()` dropped, and the plan still describes a toast

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/account/ui/PasswordForm.tsx:95-98; plan.md:543, :584
- **Detail**: Commit 2e36c1d edits an island and changes S-401's account page for every password change, not only for resets. `refresh` now reloads into `/account?saved=password`. The mechanism is correct and identical to `DisplayNameForm.tsx:83`: with no `<ClientRouter />`, `navigate()` sets `location.href`.
  - **Dropped `form.reset()`.** `onClose` became a no-op, so the new password stays in both fields until the page unloads.
  - **Re-enabled button.** `navigate()` resolves as soon as `location.href` is assigned, so the button re-enables in that window.
  - **Back-button risk.** `/account` does not send `no-store`, so it is bfcache-eligible. Pressing Back after the reload can restore the island with the new password still typed in, one "Show" toggle from view. Confidence on the bfcache path is moderate.
  - **Plan not updated.** change.md records the change, but the plan does not. plan.md:543 still says "no island changes", and :584 still says "see the 'Password changed' toast".
- **Fix**: Restore `form.reset()` in `onClose`. It runs before the navigation, so the fields are clear whatever happens next. Add a one-line addendum at plan Phase 3 §5 step 6 pointing at 2e36c1d.
- **Decision**: FIXED — `form.reset()` restored in `onClose` with its reason; addendum on plan Phase 3 §5 step 6. Check, lint and the account unit tests pass; the e2e spec covering this path was not re-run

### F4 — CLAUDE.md still says CI excludes Mailpit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: CLAUDE.md:59
- **Detail**: The line still says the CI Supabase stack "starts with `mailpit` and `edge-runtime` excluded". This change re-included Mailpit (`.github/actions/supabase-stack/action.yml`), and README was updated, so the agent-facing rule is now false. That is the lessons.md "a convention that cites a code mechanism is coupled to it" pattern. The next agent writing an email suite would add Mailpit back to the action for nothing, or wrongly assume CI can't read mail.
- **Fix**: Reword it: CI starts the stack with `edge-runtime` excluded and Mailpit kept, because the S-402 suites read reset mail through its API; a suite that needs an Edge Function must re-include `edge-runtime`.
- **Decision**: FIXED — CLAUDE.md:59 reworded (Mailpit kept, `edge-runtime` excluded)

### F5 — Integration suite: Mailpit waits outlive Vitest's 5 s test timeout, and the cleanup order can leak users

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/password-recovery.integration.test.ts:46-48, :99-111, :143-151; src/test/mailpit.ts:28
- **Detail**:
  - **Timeouts.** `vitest.integration.config.ts` sets no `testTimeout`, so each test gets 5 s. `waitForMessageTo` defaults to 10 s, so its descriptive `mailpit: no message to … within …` error can never fire. The replacement test chains two mail waits, up to six 400 ms throttle retries and two verifies. On CI's `--maxWorkers=2` lane, already about 1-in-5 flaky, a slow mail would show up as a bare "Test timed out in 5000ms". The suite runs in about 3 s locally.
  - **Cleanup order.** `afterAll` deletes the mail before `teardown(admin)`, so a Mailpit error skips the user teardown. The e2e spec already uses the safe order: user cleanup in `finally`.
- **Fix**: Pass an explicit timeout on the slow tests, or on the describe (precedent: `role-matrix.integration.test.ts:108`, `30_000`). Run `teardown` first, or wrap the two calls in try/finally.
- **Decision**: FIXED — `{ timeout: 30_000 }` on the describe (the Vitest 4.1 options form), with its reason; `teardown` moved into a `finally` after the mail delete. Suite 6/6, check and lint clean

### F6 — `pnpm audit --audit-level=high` now fails (new Vite advisory, unrelated to S-402)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: pnpm-lock.yaml (`vite@8.1.3` via `@astrojs/cloudflare` / `astro`)
- **Detail**: GHSA-587h-7wmj-h5pm (launch-editor, Windows-only, dev-server path) covers `vite >=8.0.0 <=8.1.5`. S-402 did not touch the lockfile, but CI's `verify` job runs this exact command, so the close-out PR (and any other push) will go red. Progress 4.1 (`/verify` green) was true when it was checked and would fail if re-run today.
- **Fix**: Move only the resolved `vite` to ≥8.1.6 (`pnpm update vite -r`, or a `pnpm.overrides` entry if the ranges don't allow it). Check the lockfile diff moves nothing else: a broad `pnpm update` also moves the Supabase CLI and with it CI's stack images (CLAUDE.md § Database & auth).
- **Decision**: FIXED differently — the user chose to bump the direct dependency rather than add an override.
  - **Why astro 7.3.8.** Every direct dep that brings Vite allows `^8.0.13`. astro 7.3.8 (patch) is the smallest direct bump that raises the floor, to `^8.3.1`.
  - **Changes.**
    - `package.json`: `astro` `^7.3.2` → `^7.3.8`, and `zod` `4.5.4` → `4.6.7`. astro 7.3.8 needs `zod ^4.6.5`, and the lessons.md Actions rule keeps the pinned Zod aligned with Astro's copy.
    - `pnpm update vite` collapsed every Vite copy onto 8.3.5 (Rolldown 1.2.14).
    - The lockfile moves only astro's own transitive deps. The Supabase CLI is untouched, and no new override was added.
  - **Verification.**
    - `pnpm audit --audit-level=high`: exit 0.
    - Check, lint, steiger, 2211 unit tests and build: green.
    - E2E: 44/45. The one failure is `generation.spec`, which could not reach the solver because no local solver was running.

### F7 — The key-leak check only sees build output, not server-rendered HTML

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/assert-server-only-supabase.mjs
- **Detail**: The postbuild scan covers every text file in `dist/client` and fails closed. But a key that reaches the browser at request time never lands there: island props and `define:vars` are serialized into the SSR HTML. A future `<X client:load supabaseKey={SUPABASE_KEY} />` would pass the build check. No `.astro` or `.tsx` file reads `SUPABASE_*` today. The flood guard rests on this invariant (CLAUDE.md "The publishable key never reaches the browser").
- **Fix**: In `e2e/specs/auth-guard.spec.ts`, assert that the HTML of `/auth/signin` and `/auth/forgot` (signed out), and of one signed-in page, contains no `sb_publishable_` and no Supabase host.
- **Decision**: FIXED — `auth-guard.spec.ts` checks that `/auth/signin`, `/auth/forgot` and `/auth/confirm` render none of the postbuild patterns. It asserts booleans only, so a failure never prints the key. Spec 11/11. No signed-in page: the guard project has no session

### F8 — Plan and doc bookkeeping drift

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:299-303, :313, Progress 1.1–4.2; docs/runbooks/email-delivery.md:135; src/middleware.ts:4-6; docs/runbooks/hosted-auth-settings.md:178
- **Detail**:
  - **Stale signatures.** The plan names `toResetOutcome(): ResetOutcome` and `requestPasswordReset(): Promise<ResetOutcome>`. What was built is `toResetReport()` / `ResetReport` (`{outcome, code, status}`) plus `formatResetReport`, and `email-link.ts` adds `landingPathFor` / `LANDING_PATHS`. The change is justified, since it is what lets the logs carry code and status, but the plan's signatures are now wrong.
  - **Pre-rebase SHAs.** The Progress SHAs for 1.1–4.2 (e2c8dd8, 6e8cc31, 3eb70fe, 88f1626) are not reachable from main. The landed commits are f4f6ba7, 5ceb0e5, 74401c8 and b740072.
  - **Stale runbook line.** `email-delivery.md:135` still calls the plain-text part "unverified"; smoke.md settled it (`multipart/alternative`).
  - **Middleware comment.** The header comment in `middleware.ts:5` still says "only the sign-in surface" is public.
  - **No "Last verified" row** records the 2026-10-22 `site_url` re-set.
- **Fix**: One doc sweep:
  - add a plan addendum for the `ResetReport` shape;
  - re-point the four Progress SHAs at the landed commits;
  - mark the plain-text part verified in `email-delivery.md`;
  - widen the middleware header comment to name the reset pages;
  - add a 2026-10-22 "Last verified" row.
- **Decision**: FIXED — all five: a plan addendum under the reset-outcome contract; the Progress SHAs re-pointed to f4f6ba7/5ceb0e5/74401c8/b740072; `email-delivery.md` records `multipart/alternative`; the `middleware.ts` header comment names the reset pages; a 2026-10-22 "Last verified" row. Prettier and eslint clean

### F9 — Phase 5 still open, and the hosted `site_url` lost its fix once for an unknown reason

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 5.3, 5.4; smoke.md:43-47
- **Detail**:
  - **Pending, not rubber-stamped.** 5.3 (coordinator M365 smoke) and 5.4 (Safe Links verdict) are acknowledged as pending in change.md and smoke.md. Until they run, the scanner rule is proven only against simulated scanners.
  - **Unexplained regression.** Between 2026-10-20 and 2026-10-22, hosted `site_url` regained the trailing slash removed after email 2, and nobody knows why. It was re-set in the dashboard. If a dashboard save of some other Auth setting re-adds the slash, links quietly return to `//auth/confirm`. Production normalizes that today, but the runbook's read-back only catches it when someone runs it.
  - 5.1 and 5.2 are backed by evidence in smoke.md.
- **Fix**: Keep 5.3/5.4 as the archive gate, as change.md already says. Add a line to smoke.md or the runbook naming the trailing-slash regression as unexplained, and re-check `site_url` (with the read-back `jq`) as part of the 5.3 run.
- **Decision**: FIXED — smoke.md § 5.3 now starts the run by re-checking `site_url` with the runbook's read-back. The regression is recorded as "cause unknown" there and in F8's "Last verified" row. 5.3/5.4 stay the archive gate

### F10 — The background reset has no time bound, so a hung send leaves no log line

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/forgot.ts:45-50; src/shared/api/supabase.ts (`createSessionlessClient`)
- **Detail**:
  - **What can go wrong.** supabase-js `resetPasswordForEmail` has no fetch timeout, and GoTrue sends the SMTP mail inline in `/recover`. Workers cancels `waitUntil` work a bounded time after the response, so a stalled send ends with no `[forgot-password]` line at all.
  - **Why it matters.** The neutral answer means that line is the only failure signal smoke.md relies on.
  - **No rejection risk.** There is no unhandled-rejection risk: `requestPasswordReset` cannot reject.
- **Fix**: Give `createSessionlessClient` a `global.fetch` that applies `AbortSignal.timeout(~20 s)`, so a stalled send logs as `unexpected` or `send-failed` instead of nothing.
- **Decision**: FIXED — `createSessionlessClient` now passes `global.fetch: timeBoundedFetch`, which uses a 20 s `AbortSignal.timeout` and merges with any caller signal via `AbortSignal.any`.
  - **Why it works.** Current Cloudflare docs confirm the 30 s `waitUntil` cap; on cancellation Workers logs only a generic warning. auth-js 2.116 maps a rejected fetch to `AuthRetryableFetchError` status 0, which `toResetReport` logs as `send-failed`.
  - **Verification.** Check, lint, steiger and unit tests: green. Rebuilt; `forgot-password-unauth.spec` and `auth-guard.spec` passed 13/13 on workerd.
