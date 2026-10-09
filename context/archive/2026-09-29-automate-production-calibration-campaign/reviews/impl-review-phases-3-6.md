<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automate the Production Calibration Campaign

- **Plan**: context/changes/automate-production-calibration-campaign/plan.md
- **Scope**: Phases 3–6 of 6 (commits 1267a6c, 853eeb8, e979664, dc8001e, 043fa65; branch `chore/automate-production-calibration-campaign-p3-6`, draft PR #130). Phases 1–2 were reviewed in `impl-review.md`.
- **Date**: 2026-10-02
- **Verdict**: REJECTED (one critical; its fix is small)
- **Findings**: 1 critical · 6 warnings · 3 observations
- **After triage (2026-10-02)**: all 10 findings fixed. Full local gate green: `pnpm check` 0 errors, lint, steiger, `pnpm test` 2059 passed, build, `mise run solver:check`. One manual follow-up is open in `follow-ups/review-fixes.md`: re-rehearse the graceful stop through `mise run`.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria as run by the reviewer

- `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test` (2031 passed), `pnpm build`: all green.
- `mise run solver:check` (ruff, mypy --strict, shellcheck): green. `mise run solver:test`: 244 passed.
- `pnpm install --frozen-lockfile`: green (criterion 4.1).
- `node bench/campaign/main.ts status` under bare Node with a scratch state dir: prints the pending grid, exit 0 (criterion 4.7).
- CI on PR #130 (run 36873251822): green.
- The manual criteria (3.3–3.6, 4.5–4.8, 5.3–5.5, 6.3–6.6) are backed by dated evidence in `change.md`. Two caveats: 6.3's graceful-stop row cannot have gone through `mise run` (F1), and 4 of 5.5's 11 fixtures are synthetic, which change.md documents.

## Scope

The files outside the plan (`runner.ts`, `lifecycle.ts`, `status-report.ts`, `analyzer-client.ts`, `campaign-cell.ts`, `campaign-preflight.ts`, `analyzer-lines.ts`, `telemetry.test.ts`) are extractions documented in change.md's "Where Phases 3–6 departed from the plan" entry. There is no scope creep. Every guardrail holds: no insert, update, delete or rpc anywhere in `bench/`, no session on disk, no CI or Playwright changes, and `contracts/`, `services/` and `src/middleware.ts` are untouched.

## Findings

### F1 — One Ctrl-C under `mise run solver:campaign` exits without parking

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: bench/campaign/main.ts:357 (`stopSignal`); spawns at bench/campaign/analyzer-client.ts:104, bench/campaign/cell-controller.ts:239, bench/campaign/lifecycle.ts:383; bench/generation-jobs.analyze.ts:145
- **Detail**: I reproduced this in a pty with mise 2026.6.14, using a stub that has the same `exec node` launcher and the same handler. One Ctrl-C delivers SIGINT twice, about 10 ms apart: once from the terminal to the process group and once forwarded by mise. The runner then takes the second-signal branch, "exiting now — nothing parked". Started with `sh launch.sh` directly, the same stub stopped gracefully. There is a second problem: every child process shares the runner's process group, so even a single SIGINT kills whatever is in flight (`pnpm analyze:jobs`, `wrangler secret bulk`, the drill's `pnpm build`/`wrangler deploy`). That non-zero exit is not treated as transient, so the runner errors out without parking. The analyzer writes `ledger.json` with a non-atomic `writeFileSync`, which a kill can cut short. The runbook (l.179), the launcher banner and the rehearsal row "Graceful stop and park" all promise a park. The rehearsal cannot have gone through mise.
- **Fix**: Ignore a repeat signal that arrives within about 2 s of the first. Spawn children with `detached: true` and kill them on the hard-exit path. Write `ledger.json` to a temp file and rename it. Then re-rehearse the graceful stop through `mise run` in a real terminal.
  - Strength: This restores the documented stop path, and all three edits are small and local.
  - Tradeoff: A genuine double-tap within 2 s counts as one, and a detached child has to be killed explicitly.
  - Confidence: HIGH — I reproduced both the mise and the direct path in this session.
  - Blind spot: I haven't checked whether newer mise (2026.9.x) still forwards the signal.
- **Decision**: FIXED — new `bench/campaign/process-lifetime.ts` holds `stopSignal`, which ignores a repeat signal within 2 s, and `spawnChild`/`run`/`stream`, which detach and track children and kill them on a hard exit. `main.ts`, `cell-controller.ts`, `lifecycle.ts` and `analyzer-client.ts` use it, which also removes F10(b)'s duplicate exec wrapper. The analyzer writes `ledger.json` via temp file and rename. Verified through `mise run` in a pty against the real module: one Ctrl-C stops gracefully and the in-flight child finishes; two Ctrl-Cs 2.5 s apart hard-exit and leave no child behind. The full graceful-stop re-rehearsal against the local stack is queued in `follow-ups/review-fixes.md`.

### F2 — A graceful stop, or `cleanup`, acts on top of an open intent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: bench/campaign/runner.ts:232-244, bench/campaign/next-step.ts:57-58, bench/campaign/main.ts:234
- **Detail**: nextStep's own rule 1 says a trailing intent is reconciled first, and `parkNow` (main.ts:225) enforces it. Two paths skip it. (a) `gracefulStop` opens a new `park` intent, and replay overwrites `pending` (journal.ts:200). Scenario: after the drill, `startGeneration` times out after the server has already acted, and the operator presses Ctrl-C during the 20 s retry sleep. The dispatch intent is lost. The orphan job is older than the next intent, so it is never adopted. Its proposal, a clone of real data, never enters `attempts`, so `cleanup` leaves it in production and still reports "no … proposal remains". (b) `cleanupStep` replays any pending action, including a `dispatch` or an `apply-cell` left by an aborted `run`.
- **Fix**: `perform` refuses to open a new intent while another is pending. `gracefulStop` then leaves the override live and says so. Like `parkNow`, `cleanup` refuses unless the pending action is `cleanup-deliver`, `delete-plan` or `park`.
- **Decision**: FIXED — `perform` throws on a new intent over an open one. `gracefulStop` reconciles an open `park` and otherwise leaves the override live and says so. `cleanup` refuses unless the open intent is one of `CLEANUP_ACTIONS`. New `bench/campaign/runner.test.ts` (2 tests) fails on the old `runner.ts` and passes with the fix.

### F3 — `setup --adopt` accepts any plan id, and `cleanup` later deletes it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: bench/campaign/main.ts:156-165
- **Detail**: The adopted id is recorded as `campaignPlanId` after nothing more than a remaining-hours read. Plans RLS lets the campaign account delete any plan, and the cleanup prompt shows only the UUID. If the operator pastes `CAMPAIGN_SOURCE_PLAN_ID`, the id most at hand, `cleanup` irreversibly deletes the real source plan and its board in production.
- **Fix**: Refuse an adopted id that equals the source plan id. Require the plan's name to match the journaled `Calibration — …` name, both at adopt time and again before `delete-plan`. Show the name in the cleanup prompt.
- **Decision**: FIXED — the analyzer's remaining-hours answer gains `nameMatches` (from `ANALYZE_EXPECT_PLAN_NAME`, a boolean only, never the name). `verifyCampaignClone` in `main.ts` refuses the source plan's id or a plan not bearing the setup's name, both at `setup --adopt` and in `cleanup` before anything is deleted, and the cleanup prompt shows the name. Verified against the local stack: matching name → `true`, wrong name → `false`, none → `null`.

### F4 — The "no active job on any plan" guard turns off after the drill

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: bench/campaign/runner.ts:251-252 (used by `waitUntilIdle`, :262)
- **Detail**: Plan l.499 makes this guard unconditional before a cell change, and the runbook and the S-308 amendment agree. In the code, once the drill journals `secretChangeDisturbsSolve: false`, `safeToChangeSecrets` returns true without checking, for `apply-cell` as well as `park`. Suppose an author's solve is running: the runner switches the secrets, `stop-if-idle` answers `busy`, and the unattended campaign halts until a human runs `resume`. Before the drill, it would have waited instead. The plan meant this flag only for parking while a solve is in flight. This drift isn't documented.
- **Fix**: Read the flag only on the graceful-stop/park path. `apply-cell` keeps reading active jobs every time.
- **Decision**: FIXED — `safeToChangeSecrets` split into `safeToPark` (honours the drill flag; used by `park`, the graceful stop and `parkNow`) and a private `nothingSolving` that `apply-cell` always waits on. The runner.test.ts test "waits for someone else's solve even after the drill…" fails on the old `runner.ts` and passes with the fix.

### F5 — Nothing ties CAMPAIGN_TARGET to CAMPAIGN_BASE_URL

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/campaign.sh:126, bench/campaign/main.ts:306-322
- **Detail**: Target local with the production URL: `setup` clones a real production plan, and only then does the local-only analyzer refuse the hosted id. That leaves an orphan clone of real student data, while the banner says "nothing hosted is touched". Target production with a localhost URL: `wrangler secret bulk` writes the real Worker's secrets, but `status()` reads the local app. The wait times out, and `status` reports "override none" while production runs on campaign budgets.
- **Fix**: In `connect()` and in the launcher preflight, require a loopback host for local and an https non-loopback host for production.
- **Decision**: FIXED — `baseUrlProblems(target, baseUrl)` in `definition.ts` (WHATWG URL parse, so userinfo tricks are caught) is checked in `connect()` before any request, with 4 tests in `definition.test.ts`. A first-pass `case` in `campaign.sh` refuses a mismatch before the banner, verified on six target/URL pairs. shellcheck is clean.

### F6 — liveVersion is journaled but never compared, and never reaches the ledger

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: bench/campaign/journal.ts:98-99, bench/campaign/runner.ts:174,210
- **Detail**: Plan l.499 records `liveVersion()` at dispatch and at terminal "so a stray deploy shows in the ledger". Today the values are only logged. Nothing compares them, and ledger rows don't carry them. The runbook allows deleting `.campaign/`, so the committed `ledger.json`, which is the record of record, keeps no trace of a stray deploy.
- **Fix**: Pass each job's `{dispatchVersion, terminalVersion}` to the analyzer the same way the cell mapping is passed (`ANALYZE_CELLS`). Add them to the ledger row, and flag a mismatch in `record` and `status`. Whether to exclude the run stays a human judgement.
  - Strength: The evidence lands in the committed record, as the plan intended.
  - Tradeoff: One more env channel into the analyzer and one more field in the ledger schema.
  - Confidence: MED — the plumbing is simple, but the mismatch rule needs care.
  - Blind spot: Every `secret bulk` also mints a Worker version. A mismatch is therefore expected on the drill's step 9, and the reader has to know that.
- **Decision**: FIXED — ledger rows carry `workerVersions {dispatch, terminal}` (default null, so older ledgers parse; a merge without versions keeps the earlier ones), and the Runs table has a "worker version" column (`same`/`changed`/`pending`/`—`). The runner passes `versionsOf(state)` as `ANALYZE_VERSIONS` JSON on every extraction, `record` logs a ⚠ on a mismatch, and `status` lists the affected runs. Exclusion stays a human judgement. 5 new ledger tests; verified end to end against a local job.

### F7 — The runner's riskiest paths are untested, and the bare-Node rule is only checked by hand

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: bench/campaign/{runner,main,analyzer-client,lifecycle}.ts (no tests); bench/campaign/definition.ts:7, bench/campaign/cell-controller.ts:8
- **Detail**: None of these has a test: `adoptable` (runner.ts:156), `withRetries`, `gracefulStop`, the cleanup ledger-copy gate (main.ts:240-261), or `analyzerEnv`'s key scrubbing. F2 and F4 sit exactly there. The runner also value-imports `src/solver-container-env.ts` under Node type stripping. That file has no imports today. If anyone adds one (`@/…`, or an extensionless path), every runner command breaks while `pnpm test` and CI stay green. Criterion 4.7 checked this once, by hand.
- **Fix**: Add a vitest that spawns `process.execPath bench/campaign/main.ts status` with a temp `CAMPAIGN_STATE_DIR` and `CAMPAIGN_TARGET=local`, which makes no network calls, and asserts exit 0. Extract `adoptable` and the cleanup gate as pure functions and test them.
  - Strength: Criterion 4.7 moves into CI. I ran that exact command in this review, and it takes under a second.
  - Tradeoff: One spawn-based test in the unit suite, plus a few extractions.
  - Confidence: HIGH — `status` already runs offline.
  - Blind spot: Whether CI's Node matches the Node 24 that type stripping needs. `.node-version` pins 24.15.0, so it should.
- **Decision**: FIXED — new `bench/campaign/main.test.ts` spawns `node bench/campaign/main.ts status` (temp state dir, local target, no network); a deliberate `@/` import in `src/solver-container-env.ts` turns it red with `ERR_MODULE_NOT_FOUND`. `isAdoptable` is extracted from `dispatch` and exported, with 4 tests (unseen-and-newer, clock skew, older orphan, already journaled), and `missingFrom` (the cleanup gate) has 2. Together with F2/F4's tests, `runner.test.ts` now covers `perform`, `gracefulStop`, `apply-cell`, `isAdoptable` and `missingFrom`. `withRetries` and `analyzerEnv` remain untested.

### F8 — Crash and hang edge cases

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: bench/campaign/journal.ts:180-189; analyzer-client.ts:104; cell-controller.ts:239; lifecycle.ts:228-237,383; telemetry.ts:113; status-report.ts:23
- **Detail**: (a) After a power loss mid-write, replay drops the torn last journal line, but `appendEntry` writes the next entry straight onto it. That entry is lost silently, and the append after it makes every command, `status` included, fail with "journal line N is unreadable". (b) Child processes have no timeout, so a hung `wrangler` hangs the runner. (c) The drill's deploy step isn't journaled before its `git commit` and `wrangler deploy`, so a resume can deploy again and roll the container a second time. (d) A non-JSON 5xx from telemetry raises a `SyntaxError` and is never retried. (e) `status` says "override none" while an `apply-cell` intent is pending, even though the secrets may already be live.
- **Fix**: (a) truncate to the last `\n` before appending; (b) add a `timeout` to each spawn; (c) journal a deploy intent first, and on resume look for an unpushed marker commit at HEAD; (d) check `response.ok` before parsing; (e) report "possibly live" while `apply-cell` is pending.
- **Decision**: FIXED (a–e) —
  - (a) `appendEntry` truncates a torn tail before writing; new journal test.
  - (b) `spawnChild` takes a required `timeoutMs` and stops the child's whole group at expiry (`run` 5 min, `stream` 45 min, analyzer 10 min); verified under bare Node: rejected at 1.5 s, no grandchild left.
  - (d) `linesFrom` throws `HttpCallError` for any refusal (non-JSON bodies included), and the telemetry client retries transient failures 3× (5 s apart); 2 new tests.
  - (e) `status` prints `override POSSIBLY cell X` while an `apply-cell` intent is open; new `status-report.test.ts`.
  - Each new test fails on the pre-fix file.
  - (c) The drill journals a `deploy-started` fact (commit plus the live Worker version) right after the marker commit. On resume, `nextDrillStep` emits `resume-deploy`, and `resumeDrillDeploy` records the deploy if the live version moved, or ships the SAME commit (no second marker) if it did not. A new `drill.test.ts` test fails on the old `drill.ts`.

### F9 — Secrets and a confirmation bypass reach further than the docs say

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/solver/campaign.sh:136-138, bench/campaign/main.ts:276
- **Detail**: The launcher exports `ANALYZER_SERVICE_ROLE_KEY`, `CAMPAIGN_PASSWORD` and the observability token into node's environment. Only the analyzer's environment is scrubbed: `wrangler`, `git`, `pnpm build`, `wrangler deploy` and the local solver (`{...process.env}`, cell-controller.ts:253) all inherit them. That contradicts plan §4.7, runbook l.77-78 and analyzer-client.ts:12-15. Separately, `CAMPAIGN_CLEANUP_CONFIRM=delete` skips cleanup's typed confirmation, and it isn't documented. If it is still exported from a rehearsal shell, a production `cleanup` runs without any prompt.
- **Fix**: In `connect()`, read those values and then delete them from `process.env`. Honour `CAMPAIGN_CLEANUP_CONFIRM` for the local target only.
- **Decision**: FIXED (differently) — the scrub happens at the one place children get an environment, not in `connect()`, because the runner reads the telemetry token lazily after it. `childEnv()` in `process-lifetime.ts` drops `ANALYZER_SERVICE_ROLE_KEY`, `CAMPAIGN_PASSWORD`, `CLOUDFLARE_OBSERVABILITY_TOKEN` and `LOCAL_SOLVER_MACHINE_PASSWORD`. It is `spawnChild`'s default env, the local solver's base env and `analyzerEnv`'s base, so the analyzer no longer receives the observability token either. `CAMPAIGN_CLEANUP_CONFIRM` is honoured only for `CAMPAIGN_TARGET=local`, and the runbook now documents it. New `process-lifetime.test.ts` (3 tests, one spawning a real child) fails when the scrub is removed.

### F10 — Small inconsistencies and bookkeeping drift

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: mise.toml:94; bench/campaign/cell-controller.ts:94,237,289; bench/campaign/lifecycle.ts:381; bench/campaign/lifecycle-numbers.ts:141; plan.md:770-796
- **Detail**: (a) The mise.toml comment leaves out `verify-startup`, `drill` and `renewal`. (b) The execFile wrapper (cell-controller.ts:237, lifecycle.ts:381) and `secondsBetween` (lifecycle-numbers.ts:141 vs generation-jobs-report.ts:145) each exist twice, and two imperative `while` polls sit beside `pollUntil`, against the lessons.md rule to prefer declarative pipelines. (c) The Phase 1–2 Progress SHAs (8876160, 27d9cb9) are pre-rebase commits that no branch contains. The commits that landed are 8fe5d30, 33c539d and d4c5f05. (d) Criterion 5.5 says "real captured lines", but 4 of the 11 fixtures are synthetic. change.md says so and hands their replacement to S-308 Phase 3.
- **Fix**: Complete the mise list, share the helpers, and re-point the Phase 1–2 SHAs. Leave (d) as documented.
- **Decision**: FIXED (a, b, c; d left as documented) —
  - (a) The mise.toml comment names `verify-startup`, `drill` and `renewal`.
  - (b) The execFile wrapper was deduplicated by F1. `lifecycle-numbers.ts` now imports the report's NaN-safe `secondsBetween` (a type-only module, so it loads under bare Node, and `main.test.ts` guards that) and rounds on top. The two `while` polls were left as they are, deliberately: rewriting them changes no behaviour.
  - (c) Progress rows 1.1–1.7 → 8fe5d30 and 2.1–2.7 → 33c539d.

## Triage summary

| Finding | Decision |
|---|---|
| F1 Ctrl-C under mise | FIXED: `process-lifetime.ts`, debounced stop, detached and timed children, atomic ledger write |
| F2 Intent over an open intent | FIXED: guard in `perform`; `gracefulStop` and `cleanup` refuse |
| F3 `--adopt` any plan id | FIXED: `verifyCampaignClone` (not the source; name must match) at adopt time and in cleanup |
| F4 Drill flag disables the cell-change guard | FIXED: `safeToPark` and `nothingSolving` split |
| F5 Target/URL mismatch | FIXED: `baseUrlProblems` in `connect()`, plus a launcher first pass |
| F6 liveVersion not in the ledger | FIXED: `workerVersions` on ledger rows, a ⚠ from `record`, a block in `status` |
| F7 Untested risky paths | FIXED: bare-Node `main.test.ts`, `isAdoptable`/`missingFrom` tests (`withRetries` and `analyzerEnv` still untested) |
| F8 Crash/hang edges | FIXED (a–e) |
| F9 Secrets reach every child | FIXED differently: `childEnv()` scrub at spawn; cleanup bypass is local-only |
| F10 Hygiene | FIXED (a–c); (d) left as documented |

**Process note.** Twice during triage (F3, F5) the reviewer wrote `Decision: SKIPPED` into this file in the same batch as the question, before the answer arrived. Both were reverted to PENDING before the chosen fix was applied, and the final decisions above are the ones the author made.
