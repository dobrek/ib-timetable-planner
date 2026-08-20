<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Staged Progress + Durable Checkpoints (S-303)

- **Plan**: context/changes/staged-progress-and-checkpoints/plan.md
- **Scope**: Full plan (Phases 1–6 of 6)
- **Date**: 2026-08-20
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations
- **Triage (2026-08-20)**: all 9 FIXED in the working tree (uncommitted at review time) — see each finding's Decision line. Post-fix gates: astro check 0 errors, eslint, steiger, vitest 1674, build, solver pytest 156, mypy, ruff — all green.

Automated gates re-run during review, all green: solver pytest 154 passed, mypy --strict, ruff, shellcheck; `astro check` 0 errors, eslint, steiger, vitest 187 files / 1674 tests, `pnpm build`; goldens byte-identical; stale-prose grep empty; integration (solver-credential, generation-jobs, plans-list) 44 tests green. Not re-run: `solver-transport.integration.test.ts` (solver service not running locally; green at 749336e, covered by CI).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Poll store attaches its DOM listener during render and dies on a StrictMode remount

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/_pages/plans-list/model/job-progress-store.ts:118; src/_pages/plans-list/model/use-generation-indicators.ts:22-24
- **Detail**: `createJobProgressStore` adds the `visibilitychange` listener in its constructor, which the hook runs inside a `useState` initializer (during render). `dispose` is one-way, so a StrictMode mount→cleanup→remount disposes the retained store and the hub never polls again; a double-invoked initializer leaks a listener. Latent today (no StrictMode wrapper in the repo), but diverges from the cited precedent `board-zoom.ts:44-54`, which attaches inside `subscribe`.
- **Fix**: Attach the listener on first `subscribe`, detach when the last listener leaves (the timer already follows that lifecycle); drop `disposed`/`dispose` + the `useEffect` teardown (or keep `dispose` for tests); replace the `isDisposed()` late-resolve guard with a `listeners.size === 0` check.
  - Strength: Matches `board-zoom.ts`; React owns the lifecycle; remount re-arms naturally.
  - Tradeoff: "quiet after dispose" tests become "quiet after last unsubscribe"; ~20 lines.
  - Confidence: HIGH — in-repo precedent, other store rules untouched.
  - Blind spot: the late-resolve guard must be preserved under the new check.
- **Decision**: FIXED — listener attached on first subscribe / detached on last unsubscribe; `dispose` re-armable; hook `useEffect` teardown removed.

### F2 — The plan-detail strip still has the hydration bug `useHydrated` was written to fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:38,107-108; src/_pages/plans-list/model/use-hydrated.ts
- **Detail**: `use-hydrated.ts` documents (browser-verified) that SSR on workerd formats `toLocaleTimeString` in UTC while the browser uses the reader's zone. The strip — edited in this branch — still renders `formatStarted(job.createdAt)` from SSR. Pre-existing, but the branch created the fix idiom and left its sibling.
- **Fix A ⭐ Recommended**: Move `useHydrated` to `src/shared/lib/` and apply the `<time dateTime>` + post-hydration formatting pattern in the strip.
  - Strength: One idiom for local-time rendering; `shared/lib` is the hook's FSD home.
  - Tradeoff: Touches plan-detail `ui/` (not `model/`); strip test update.
  - Confidence: HIGH — the cell already proves the pattern.
  - Blind spot: invisible for UTC readers, still present.
- **Fix B**: Leave the code; note the known mismatch in the strip's docstring pointing at `useHydrated`.
  - Strength: Zero risk.
  - Tradeoff: Ships a known wrong time for non-UTC readers.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `useHydrated` moved to `src/shared/lib/use-hydrated/`; strip renders `<time dateTime>` + post-hydration local time; test asserts it.

### F3 — Success criterion 5.4 is literally false: plan-detail `model/` has a diff

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/_pages/plan-detail/model/generation/use-generation-job.ts:24-29; plan.md:630, :828
- **Detail**: Phase 6 §3 ordered a docstring edit to `use-generation-job.ts:25`, contradicting Phase 5's "no diff" criterion. The diff is comment-only, so FR-312 holds in substance.
- **Fix**: Amend plan.md 5.4 to "no non-comment diff in `src/_pages/plan-detail/model/**` (Phase 6 trues up one docstring)".
- **Decision**: FIXED — plan.md 5.4 criterion + Progress row reworded to "no non-comment diff".

### F4 — Scope extension: discovery read + "rule 5" tick on tab focus

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plans-list/api/generation-status.ts:30-61; model/schemas.ts:38-41; model/job-progress-store.ts:110-116; model/use-hydrated.ts
- **Detail**: Action input is `{ jobIds, planIds }` (plan: `{ jobIds }.min(1)`), with a second active-by-planIds read; a tab becoming visible ticks once even when idle; `use-hydrated.ts` is unplanned but necessary. All justified in docstrings and bounded.
- **Fix**: Add a short addendum to plan.md Phase 5 naming the discovery read, rule 5, and `use-hydrated.ts`.
- **Decision**: FIXED — plan.md Phase 5 §7 addendum added (discovery read, rule 5, `useHydrated`, store lifecycle).

### F5 — A mid-ladder checkpoint with only OPTIMAL stages reports `stopReason: "budget"`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_engine/solve.py (`_checkpoint` → `_stop_reason`)
- **Detail**: `_checkpoint` sets `proven_optimal=False` unconditionally; with `fell_short` empty the derivation falls through to `"budget"`. Contract-valid; unread today.
- **Fix**: Return `None` when nothing fell short and nothing was cancelled; add a matrix test case.
- **Decision**: FIXED — `_stop_reason` returns `None` (key omitted) when no stage fell short; new matrix test; two tests that pinned the old value retargeted.

### F6 — `progress()` docstring says "never raises" but `ValueError` escapes

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/supabase.py (`progress`)
- **Detail**: `response.json()` is in the try, but only `SupabaseError`/`httpx.TransportError` are caught. The runner's blanket `except Exception` saves the solve.
- **Fix**: Add `ValueError` to the except tuple.
- **Decision**: FIXED — `ValueError` added to the except tuple.

### F7 — Loader re-types the six-column projection instead of importing `STATUS_COLUMNS`

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plans-list/api/loader.ts:67 vs api/generation-status.ts:24
- **Detail**: `STATUS_COLUMNS`'s docstring promises the loader and poll project identically; the loader duplicates the literal.
- **Fix**: Import `STATUS_COLUMNS` in the loader.
- **Decision**: FIXED — loader imports `STATUS_COLUMNS`.

### F8 — Engine test (b) is weaker than planned

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: services/solver/tests/test_stage_stop.py:109-117
- **Detail**: Plan: unreachable target → same board as a no-target run. Actual asserts `stopped_by in (None, "budget")` with no board comparison.
- **Fix**: Add a board-equality assertion against a no-target run.
- **Decision**: FIXED — `test_an_unreachable_target_is_indistinguishable_from_no_target` pins transcript + board equality against a plain run.

### F9 — Two prose nits: stale comment + undocumented solver-thread predicate contract

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plans-list/ui/PlanIndicatorsCell.tsx:84; services/solver/src/cpsat_engine/solve.py (`SolveHooks` docstring)
- **Detail**: Cell comment references a `suppressHydrationWarning` that isn't there. `SolveHooks` says exceptions propagate — true for `on_stage`, but `should_stop` runs inside the OR-tools callback on the solver thread.
- **Fix**: Point the cell comment at `useHydrated`; add "`should_stop` must be total — it runs on the solver thread" to `SolveHooks`.
- **Decision**: FIXED — cell comment points at `useHydrated`; `SolveHooks.should_stop` documented as total / solver-thread.
