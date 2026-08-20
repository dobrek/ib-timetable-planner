<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Staged Progress + Durable Checkpoints (S-303)

- **Plan**: context/changes/staged-progress-and-checkpoints/plan.md
- **Mode**: Deep
- **Date**: 2026-08-19
- **Verdict**: REVISE (all fixes are small edits; no rethink needed)
- **Findings**: 0 critical · 6 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

30/31 paths ✓ (`services/solver/tests/test_settings.py` absent — plan hedges it), all solver/app symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (6/6 phases, 24/24 criteria). Sub-agent verified: `to_generation_result` reads only `board`/`stages`(via `elapsed_s` property)/`proven_optimal`; Mode A = 10 stages (tier 1 completeness + tiers 2–10); `_run_solver` returns the solver and takes `config`; no `CpSolverSolutionCallback` usage exists; UPDATE grant + test allowlist already hold the progress columns; `generation_jobs` RLS is `using(true)` for authenticated; no exhaustive switch over `stopReason` anywhere in `src/`.

## Findings

### F1 — Poll store can only see jobs that existed at SSR time

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 §4–5 (status action keyed by jobIds; idle hub has no timer)
- **Detail**: The store is seeded from SSR'd `indicators` and polls `readGenerationJobStatuses({ jobIds })` only while ≥1 active job is known. (a) A hub tab that was open/idle when the author hit Generate on a plan page (the realistic two-tab flow) never discovers the new job until reload; returning from hidden only resumes an already-active timer. (b) Terminal memory is in-RAM only — after a reload a finished job leaves no trace on `/plans` (loader fetches active rows only); acceptable (the strip covers it) but should be stated in Desired End State §2.
- **Fix**: Add a one-shot *discovery* read on `visibilitychange → visible` (and on subscribe), keyed by planIds — widen the Zod input to `{ jobIds?: uuid[]; planIds?: uuid[] }` with active-only semantics for planIds, or add a sibling `readActiveGenerationJobs`. Keep the 5 s timer active-only. Note (b) in Desired End State.
  - Strength: Closes the two-tab gap with one extra request per tab-focus; keeps "idle hub has no timer" true.
  - Tradeoff: One more action input shape / test case in Phase 5.
  - Confidence: HIGH — `generation_jobs_active_per_plan` makes the planIds read ≤ N rows; RLS is `using(true)` for authenticated.
  - Blind spot: None significant.
- **Decision**: PENDING

### F2 — HH:MM rendered with `toLocaleTimeString` will hydration-mismatch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §2 ("Time via the same HH:MM formatting the strip's formatStarted uses"); manual criterion 5.9
- **Detail**: `formatStarted` (`GenerationStatusStrip.tsx:101-102`) is `new Date(iso).toLocaleTimeString(undefined, …)`. `PlansHub` is `client:load`, SSR'd on workerd (UTC); the browser formats in the reader's zone, so every non-UTC user gets a text-content hydration mismatch on the Activity cell (React 19 recovers by client-rendering the subtree and logs a recoverable error). The strip very likely carries the same latent mismatch today; mirroring it spreads it. Criterion 5.9 (JS-disabled SSR) would show UTC.
- **Fix**: Have `describeGenerationIndicator` return `startedAt` as data; the cell renders `<time dateTime={iso} suppressHydrationWarning>HH:MM</time>`. Optionally apply the same attribute to the strip while Phase 5 touches it.
- **Decision**: PENDING

### F3 — Five test sites assume exactly two PATCHes, plan names one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4(a); Current State ("`:348-370` destructures exactly two")
- **Detail**: `services/solver/tests/test_service.py` has `claim, finish = fake.patches()` at :353 AND :462, plus index-based `fake.patches()[1]` at :406, :487, :508. All five break once progress PATCHes interleave; the plan lists one.
- **Fix**: Enumerate all five sites in Phase 3 §4(a) and prescribe a `first/last` (or filter-by-role) helper on the fake so the pins read by role, not by position.
- **Decision**: PENDING

### F4 — Engine neutrality tests (b)/(c) assert byte-identity CP-SAT can't give

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4 tests (b) "same board as no-target", (c) "identical `stages`"
- **Detail**: `StageReport.wall_clock_s` differs on every run, so "identical `stages`" is never true; with `workers` > 1 under time budgets CP-SAT is non-deterministic, so "same board" is flaky. The existing suite (`test_solve.py:28-30`) asserts *properties* on fixtures that prove OPTIMAL within budget, never board equality.
- **Fix**: Project stages to `(tier, name, status, best, bound, stopped_by)` and compare those; for (b) assert `status`/`best`/`stopped_by == "budget"` rather than board equality; run neutrality on the OPTIMAL-within-budget fixture config (`CLEAN`/`DIRTY`) with `workers=1`.
- **Decision**: PENDING

### F5 — Zod StageReport parser has no consumer in S-303

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 1 §3 (`stage-report.ts`: `storedStageReportSchema`, `storedStagesSchema`, `parseStoredStages`) + Phase 1 §5 Zod↔ajv matrix
- **Detail**: The plan's "Narrow projections" rule says the app never reads `stages` in S-303, and the only existing read site (`src/_pages/plan-detail/api/generation-delivery.ts:73`, a raw cast `stages: StoredStageReport[]`) is not wired to the parser anywhere in the plan. The schema, parser, its tests and the bench matrix ship with zero callers — the type move + `stoppedBy` is all Phase 1 needs.
- **Fix A ⭐ Recommended**: Wire `parseStoredStages` at the one read site in `generation-delivery.ts`
  - Strength: Gives the parser a real job (hardens `deriveCleanLabel` against a malformed transcript at delivery) for one line; `plan-detail/model/**` stays untouched so the FR-312 no-diff proof holds.
  - Tradeoff: Phase 1 now touches `plan-detail/api`.
  - Confidence: HIGH — `deriveCleanLabel` already treats a sparse/missing transcript as `unavailable`, so `[]` on parse failure is the intended degrade.
  - Blind spot: None significant.
- **Fix B**: Drop schema/parser/ajv matrix from Phase 1; keep the type move + `stoppedBy`
  - Strength: Strictly less code; no consumer means no maintenance.
  - Tradeoff: The hand-written type stays ungated; S-305 will likely want the parser and re-adds it.
  - Confidence: MEDIUM — depends on whether S-305 reads `stages` client-side.
  - Blind spot: S-305's plan is not written.
- **Decision**: PENDING

### F6 — Ladder behaviour after a `cancelled` stage is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2–3 (`should_stop` → `fired="cancelled"`; `stopReason` derivation)
- **Detail**: When `should_stop()` fires, the callback ends *that* stage, but `_run_ladder` (`solve.py:373-401`) loops on to the next tier, whose callback fires again on its first (hinted) solution — a stop cascades through the remaining tiers, each recorded `cancelled` with `best` = warm start, burning a solve + a `completed` PATCH per tier. The seam is S-303's; S-305 inherits whatever it does.
- **Fix**: Specify: `_run_ladder` breaks out after a stage whose `stopped_by == "cancelled"` (and checks `should_stop()` before starting a stage); remaining tiers are not reported; `stopReason` derivation unchanged. Add to test (f).
- **Decision**: PENDING

### F7 — `on_solver` fires twice on the clean-fallback path

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §4 test (e) "`on_solver` is called once per stage"
- **Detail**: `solve_complete` (`solve.py:204-208`) calls `_feasibility` twice when clean mode proves INFEASIBLE; each goes through `_run_solver`, so tier 1 yields two `on_solver` calls. Test (e) as worded fails there.
- **Fix**: Word it "≥ once per stage; the latest handle wins (`attach_solver` overwrites)".
- **Decision**: PENDING

### F8 — Minor citation drift

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State (`eslint.config.mjs:60-67`); Phase 3 §4(h)
- **Detail**: The file is `eslint.config.js:59-67`. `services/solver/tests/test_settings.py` does not exist (no test touches `load_settings` today) — the plan hedges "if one exists".
- **Fix**: Correct the path; make Phase 3 §4(h) "create `tests/test_settings.py`".
- **Decision**: PENDING
