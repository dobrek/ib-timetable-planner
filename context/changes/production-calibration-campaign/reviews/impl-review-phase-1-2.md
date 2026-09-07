<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Production Calibration Campaign (S-308)

- **Plan**: context/changes/production-calibration-campaign/plan.md
- **Scope**: Phases 1–2 of 5 (the two code phases; Phases 3–5 are production-gated)
- **Date**: 2026-09-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations — all triaged and fixed in the working tree

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gates re-run on the reviewed tree (`0ca3f07`) and again after the fixes: `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build`, `mise run solver:check`, `mise run solver:test` — all green. `mise run solver:image:build` + `:image:smoke` (1.3) were not re-run (Docker); accepted on the recorded sha. Manual items 1.5, 2.3, 2.4 stay pending (production/hosted-gated).

Drift check: all nine planned items in Phases 1–2 MATCH. Extras, all benign: `analyze:plans` gained a file argument (necessary — both analyzers share the `bench/**/*.analyze.ts` include), `_positive_float` was split onto a shared `_read_positive_float` helper, and plan/change bookkeeping. Guardrails held: no wire change, no claim-CAS change, no target values shipped, `sleepAfter` untouched, no Mode A interactive path or Mode B.

## Findings

### F1 — Budget parser accepts inf and nan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/settings.py:225-230
- **Detail**: `_read_positive_float` rejected only `ValueError` and `value <= 0`, so `inf` and `nan` passed silently (verified: `SOLVER_STAGE_BUDGET_S=inf SOLVER_MODE_A_BUDGET_S=nan` loaded as `(inf, nan)` with no complaint) and would reach `max_time_in_seconds` — an unbounded or undefined stage. The same hole predated this diff on the heartbeat path.
- **Fix**: Reject `value <= 0 or not math.isfinite(value)` with a "is not a finite positive number" complaint; `inf`/`nan` cases added to both parametrised degrade tests.
- **Decision**: FIXED

### F2 — The clean-fallback flag cannot fire for its named cause

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: bench/generation-jobs-report.ts:80-90 (plan flaw: plan.md:151 specified the threshold)
- **Detail**: The flag fired when `elapsed − Σ wallClockS > Mode A budget` and blamed the clean-mode fallback. `solve.py:325-328` re-solves only on a PROVEN INFEASIBLE, which returned before the deadline — so the hidden solve is always strictly shorter than one Mode A budget and could never cross the threshold on its own, while a fail-forward reclaim, a cancel or a failed job would cross it and be misattributed. `settings.py:36-38` repeated the "spends a second Mode A budget" overstatement.
- **Fix A ⭐ Recommended**: Always print the unaccounted seconds on the clock line; gate the flag on `status === "succeeded"` and a 30 s `OVERHEAD_ALLOWANCE_S`; the message names the fallback as bounded by the Mode A budget. Settings comment reworded to "up to ~28 … a second solve bounded by that budget".
  - Strength: Gives the ledger the number Phase 4.1 asks for ("whether the clean fallback fired"); a boolean that cannot fire gives the campaign nothing.
  - Tradeoff: The overhead constant is a guess until Phase 3 measures production overhead — see follow-ups.
  - Confidence: HIGH — the INFEASIBLE-only gate in solve.py is unambiguous.
  - Blind spot: Real container-side model-build overhead unmeasured.
- **Fix B**: Keep the threshold, gate on succeeded, drop the attribution.
  - Strength: Minimal; never misattributes.
  - Tradeoff: Still silent on the actual fallback in every realistic case.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A

### F3 — Flag threshold is the Worker's current constant, not the run's

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: bench/generation-jobs.analyze.ts:59
- **Detail**: `Number(CONTAINER_MODE_A_BUDGET_S)` is whatever is checked in when the analyzer runs. Harmless through Phase 4 (Mode A stays 300), but once Phase 5 ships a new value, re-analysing older rows would name the wrong bound silently — the row records no budgets.
- **Fix**: `ANALYZE_MODE_A_BUDGET_S` override (positive number wins, else the constant); the bound in use is printed at the top of the report so a ledger paste is self-describing.
- **Decision**: FIXED

### F4 — Manual criterion 1.4 has evidence but is unchecked

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/production-calibration-campaign/plan.md:430
- **Detail**: change.md's 2026-09-07 note records exactly what 1.4 asks for (startup line at `SOLVER_STAGE_BUDGET_S=5`, budget-stopped stages at 5.03–5.06 s, the engine-default control at 120.02–120.18 s), yet Progress left the box unchecked.
- **Fix**: Flip 1.4 to `- [x] … — 0ca3f07`.
- **Decision**: FIXED
