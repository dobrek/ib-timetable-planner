<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Solver Service Transport (F-302)

- **Plan**: context/changes/solver-service-transport/plan.md
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → SOUND after triage (all six findings fixed in the plan)
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → resolved |
| Plan Completeness | FAIL (mechanical) → resolved |

## Grounding

9/9 paths ✓, 12/12 symbols ✓, brief↔plan ✓. Deep verification (sub-agent) CONFIRMED: engine seam (`solve_complete`, `SolveConfig.workers/log_dir`, non-exceptional `notes["outcome"]` ∈ complete/infeasible/unknown, `PreconditionError` at model.py:56, private `_placement` parser at schema.py:178), DB surface (exactly the 11-column UPDATE grant, RLS `using status in (queued,running)` / `with check status in (running,succeeded,failed,stopped,interrupted)` — running→running permitted), contract `$defs.SolveRequest` (required formatVersion+snapshot, warmStart refs the same GeneratedPlacement as the result), blast radius (plan's ~20-reference list complete to within one docstring), app seams (`env:local` wholesale copy, steiger accepts an `api` segment, solver-credential gating pattern at lines 37-46, `experiment:goldens` script), pyproject (dev group, TEST-LANE comment, hatch wheel packages, 56 tests collected).

## Findings

### F1 — Progress headings don't match phase headings (3 of 5)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress section
- **Detail**: /10x-implement matches Progress subsections to phase headings by exact title. Phase 3 ("both-suites contract gate" vs "contract gate"), Phase 4 (dropped "(`cpsat_service`)"), Phase 5 ("mise graduation" vs "mise") all mismatched. Row counts 1.1–5.6 otherwise mapped cleanly.
- **Fix**: Rename the three Progress subheadings to match the body headings verbatim.
- **Decision**: FIXED (Progress subheadings renamed)

### F2 — Runner's Dump construction omits required `format_version`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §5 (runner.py)
- **Detail**: `Dump` (schema.py:93-107) has a sixth required field, `format_version`, with no default — the plan's construction spec was a TypeError as written. The empty stand-ins (`meta`, `greedy_diagnostics`, `objective`) are verified safe on the solve path.
- **Fix**: Specify `format_version=body["formatVersion"]` in the Dump construction line.
- **Decision**: FIXED (Phase 4 §5 updated)

### F3 — Stored `result` jsonb won't be in declared array order

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §5 — outcome mapping
- **Detail**: `to_generation_result` (solve.py:268) emits placements in board order; the declared array sorts are applied by `wire_result` (wire.py:80) by design ("HERE rather than at the producer"). Writing raw producer output stores non-canonical bytes; later canonical comparisons (S-301's oracle, hashing) would mismatch. Stages already got the wire.py treatment; result skipped it.
- **Fix**: `result=wire_result(to_generation_result(dump, result))` + declared-order assertion in test_service.py.
- **Decision**: FIXED (outcome mapping + test coverage updated)

### F4 — "No edit needed" on test_contract.py contradicts criterion 1.3

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Key Discoveries + Phase 1 §1/§3
- **Detail**: The `parents[3]` anchor is promotion-proof, but `test_contract.py:7`'s docstring names `poc/cp-sat/` as pytest's rootdir — criterion 1.3's grep would fail on a file the plan twice said needs no edit. Only omission in the full blast-radius sweep.
- **Fix**: Add the docstring to Phase 1 §3's edit list; soften "no edit needed" to "no path edit needed".
- **Decision**: FIXED (all three mentions updated)

### F5 — Validator anchor: parents[3] doesn't transfer to app.py

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §6 (app.py)
- **Detail**: app.py sits one level deeper than test_contract.py (`services/solver/src/cpsat_service/app.py` → repo root is `parents[4]`); copying `parents[3]` verbatim lands on `services/`. The anchor also assumes a repo checkout — `contracts/` is not in the wheel, so S-302's image must COPY it.
- **Fix**: State `parents[4]` explicitly + one-line S-302 container note.
- **Decision**: FIXED (Phase 4 §6 updated)

### F6 — Background uvicorn in CI fails silently on crash

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §5 (CI wiring)
- **Detail**: If the background service dies mid-suite, the only symptom is a vitest poll timeout with zero service output in the CI log — the silent-failure class the plan avoids elsewhere.
- **Fix**: Redirect uvicorn output to a log file + `if: failure()` step that cats it.
- **Decision**: FIXED (Phase 5 §5 updated)

## Verified corrections that needed no plan edit

- `to_generation_result` lives in `solve.py:268` (the plan's References already cite solve.py — correct).
- `config-status.ts` precedent is a `Boolean(...)`-flag gate rather than literally "null when unset" — fine as the precedent to mirror.
- The outcome mapping is `solve_complete`-only (`solve_repair`/`solve_staged` don't set `outcome`) — the plan only uses `solve_complete`, so no gap.
