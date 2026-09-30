<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Automate the Production Calibration Campaign

- **Plan**: context/changes/automate-production-calibration-campaign/plan.md
- **Scope**: Phases 1–2 of 6 (commits 8876160, 27d9cb9; 1.8 and 2.8 are post-merge and pending by nature)
- **Date**: 2026-09-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria as run by the reviewer

- `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test` (1893 passed, nine-key pin included), `pnpm build`: all green.
- `mise run solver:check` (ruff, mypy --strict, shellcheck) and `mise run solver:test` (243 passed, including the objective suite): green.
- `pnpm test:integration src/test/solver-credential.integration.test.ts`: 12/12.
- 1.1 checked without a reset: migration `20260930081740` is applied locally; `solver_job_writer` holds UPDATE only on `solver_config`; `anon` holds nothing. `db reset` was not run because it wipes local data.
- Not re-run: the `solver-transport` suite (1.3) and the image build and smoke (1.5), which need `SOLVER_MACHINE_PASSWORD`; the reviewer's shell did not have it.

## Findings

### F1 — The operator route returns a bare 500 when a Durable Object call fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/solver-container-route.ts:53,59
- **Detail**: Nothing catches a rejected `control.status()` or `stopIfIdle()`, so Astro answers with a generic 500 that is not JSON and has no `no-store`. The only consumer is Phase 4's runner, which must tell "retry" apart from "halt". This is likely in production, because a secret change resets the Durable Object and the runner polls `status()` straight after (plan l.473). Under local `pnpm preview` with containers off, the SDK constructor throws "Containers have not been enabled" (`container.js:351`), which yields a 500 rather than the documented 409.
- **Fix**: In the handler, wrap both calls in try/catch and return a JSON 503 such as `{ error, retryable: true }` with `no-store`. Log the cause, add a route test with a control that rejects, and add a row to the docblock table.
  - Strength: The error contract is fixed before Phase 4's HTTP client maps errors against it.
  - Tradeoff: About 10 lines, and the runner still has to cap its retries.
  - Confidence: HIGH — the missing catch and the constructor throw are both confirmed in the code.
  - Blind spot: Not verified whether a Durable Object reset during a secret change surfaces as a rejected RPC or is retried transparently (Phase 5 spike).
- **Decision**: FIXED — `answerFrom` in `src/solver-container-route.ts` returns a JSON 503 `{ error, retryable: true }` with `no-store`; docblock row and route test added

### F2 — The operator allowlist moved and changed shape, and the plan doesn't say so

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/solver-container-allowlist.ts:1-25
- **Detail**: Plan §2.6 specifies `src/shared/lib/ops-allowlist/` with a barrel, a concept file and a boolean predicate. The code has a top-level `src/solver-container-allowlist.ts` whose `checkOpsAccess` returns `closed | denied | allowed`. The behaviour matches (an empty list admits nobody; trimmed, case-insensitive comparison), and the three-way result is justified by the 404-vs-403 split. The reason for the move is written only in the file's docblock, not in the plan, change.md or the commit message. The same applies to `getSolverOpsAllowlist`, which lives in the entity's `solver-container-control.ts`.
- **Fix A ⭐ Recommended**: Add a dated addendum to plan §2.6 recording the new location, the three-way result, and where `getSolverOpsAllowlist` lives.
  - Strength: The code is defensible (its only consumer is the top-level route handler), and later reviews of Phases 4–6 would treat the plan as accurate.
  - Tradeoff: The top-level `solver-container-*` family grows to 7 modules that steiger does not structure-check.
  - Confidence: HIGH — documenting with an addendum is how this repo already handles drift.
  - Blind spot: None significant.
- **Fix B**: Move the module to `src/shared/lib/ops-allowlist/` as planned, keeping the three-way result.
  - Strength: Matches the plan and the barrel-plus-concept-file convention; steiger inspects it.
  - Tradeoff: Churn with no change in behaviour, and a `shared/lib` module whose only consumer sits outside FSD.
  - Confidence: MED — either placement passes the gates.
  - Blind spot: Whether Phase 4 adds a second consumer.
- **Decision**: FIXED (Fix A) — dated addendum under plan §2.6

### F3 — The second `solver_config` write happens only in clean mode

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: services/solver/src/cpsat_service/runner.py:305
- **Detail**: Plan §1.4 says "two best-effort writes". The code skips the second write when `result.clean_fallback is None`, so a policy without clean mode gets one write. Harmless, since the second write would be identical, and pinned by `test_a_policy_without_clean_mode_records_once_and_never_names_the_fallback`.
- **Fix**: Add one line to the same plan addendum as F2.
- **Decision**: FIXED — dated addendum under plan §1.4

### F4 — The `stopIfIdle` docblock overstates what happens in the race

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/solver-container.ts:136-152
- **Detail**: The Durable Object's input gate opens while it awaits the probe, so a dispatch can land between the probe and `stop()`. A solve accepted in that window gets SIGTERM before its first stage and ends `interrupted` with no checkpoint and no board. The docblock says such a solve is not "lost": the row does not get stuck, but nothing is delivered. The window is milliseconds, and the runner's no-active-job rule covers it.
- **Fix**: Reword the docblock so it describes the no-checkpoint outcome accurately.
- **Decision**: FIXED — `stopIfIdle` docblock now states the no-checkpoint outcome and how the campaign closes the window

### F5 — The second write sits on the SIGTERM shutdown path

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/runner.py:305-308
- **Detail**: When the stop latch fires, the clean-mode record write still runs before the terminal `finish`. It can take up to 30 s (httpx timeout), or about 60 s if the token has to be re-minted. `SHUTDOWN_JOIN_BUDGET_S = 120` (`app.py:38`) was sized for about 40 s of terminal-write retries. The worst case of roughly 100 s is still inside the budget but eats most of the margin.
- **Fix**: Skip the second write when `entry.stop.is_set()`; a stopped solve's fallback fact is partial anyway.
- **Decision**: FIXED — the latch is read right after `solve_complete` and the fallback rewrite is skipped under a stop; test `test_a_latched_run_records_once_so_nothing_queues_ahead_of_its_terminal_write` (red before, green after)

### F6 — The "invisible" 404 can be told apart, and 403 vs 404 shows whether a campaign is live

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/solver-container-route.ts:49-50, src/pages/api/solver/container.ts:8
- **Detail**: With the allowlist empty the route returns a JSON 404 with `no-store`, which differs from Astro's own 404. Once the allowlist is set, any signed-in author gets 403 instead, so they can tell a campaign is live. Only hand-provisioned accounts get this far. The allowlist is keyed on email, which can change, but Supabase confirms email changes, so the risk is low.
- **Fix**: Change "invisible" to "hidden from non-operators" in the docblocks and README.
- **Decision**: FIXED — "invisible" replaced with an accurate 404 description in the route table, the Astro route, the allowlist docblock and the test title; a note under the route table states both leaks

### F7 — Comments and docs have drifted from the code

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/solver/tier3.sh:80, README.md:261, services/solver/src/cpsat_service/runner.py:437-440, scripts/solver/common.sh:24-26
- **Detail**: (a) tier3.sh says "Keys 2-4 are inert in production" and README says "The last three are inert"; both include `SOLVER_MACHINE_PASSWORD`, a required production secret. The error predates this change but was carried into lines this change edited. (b) README and the env docblock describe the runner parking and cleaning up as current fact; that runner is Phase 4 and does not exist yet. (c) The `_write_run_record` docstring says its safety net covers building the record, but `_HOST` is computed at import time, outside it (negligible risk). (d) common.sh says not to route guards through `die`; the password guard now goes through `die` via `append_literal`.
- **Fix**: Reword (a) to exclude the password, mark (b) as Phase 4 behaviour, correct the docstring in (c), and update the common.sh note in (d) to allow helper-wrapped guards.
- **Decision**: FIXED — (a) tier3.sh + README exclude the password from "inert"; (b) env docblock + README mark park/cleanup and Cell D validation as planned Phase 4 behaviour; (c) `_write_run_record` docstring names the `_HOST` exception; (d) common.sh allows helper-wrapped guards
