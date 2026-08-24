<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Job-Aware Container Lifecycle (S-304)

- **Plan**: context/changes/job-aware-container-lifecycle/plan.md
- **Mode**: Deep
- **Date**: 2026-08-24
- **Verdict**: REVISE → SOUND after triage (all findings fixed in plan)
- **Findings**: 2 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL (F1 — fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F3, F4 — fixed) |
| Plan Completeness | WARNING (F2, F6 — fixed) |

## Grounding

12/12 paths ✓, symbols ✓ (2 line-pins drifted — F6), brief↔plan ✓. Verified against source:
default `onActivityExpired()` = `this.stop()` and the SDK re-arms + renews after the override
returns (`container.js:748-754`, `:1569`); `containerFetch` renews (`:890`); overriding `alarm()`
is genuinely dangerous (`:1502-1590`); uvicorn awaits the lifespan shutdown **unbounded**
(`server.py:301-302`, `timeout_graceful_shutdown` bounds only HTTP tasks), SIGINT/SIGTERM share
the path; a mid-ladder checkpoint passes `verifyGeneration` (no completeness requirement) and
`checkpoint` is byte-shaped identically to `result`; the solver RLS `using (status in
('queued','running'))` makes late writes from a reclaimed row match nothing; `registry.__len__`
exists; `GET /jobs/active` collides with nothing; `JobEntry.thread` is populated (`stop_all` is
new, as planned).

## Findings

### F1 — Interrupted detection keyed on `stoppedBy: "cancelled"` is unreliable

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1, item 3 — Runner terminal mapping
- **Detail**: The engine records `stoppedBy: "cancelled"` only when `should_stop` fires at an improving solution (`solve.py:766-787`); an external `stop_search()` yields `"budget"` on FEASIBLE / `None` on UNKNOWN (`solve.py:823-835`). Holes: stop during the last stage → written `succeeded`; stop before the first feasible solution → outcome `"unknown"` → written `failed`, clone swept. Phase 1's test (b) would pass only by timing luck.
- **Fix A ⭐ Recommended**: Key the terminal mapping on the latch (`entry.stop` set with reason `"shutdown"` ⇒ `interrupted`), stage scan informational only
  - Strength: One deterministic signal covers all holes; checkpoints make it lossless.
  - Tradeoff: A solve completing ms before SIGTERM is labelled interrupted (cosmetic; stage-10 checkpoint = final board).
  - Confidence: HIGH — the latch is set under the registry lock; no timing dependency.
  - Blind spot: The no-checkpoint interrupted shape must be pinned in Phase 1's tests (added).
- **Fix B**: Keep the stage scan, enumerate the two edge outcomes
  - Strength: Completed-before-latch runs keep `succeeded`.
  - Tradeoff: Brittle coupling to engine internals.
  - Confidence: MEDIUM.
  - Blind spot: A third unenumerated timing may exist.
- **Decision**: FIXED via Fix A

### F2 — Progress headings don't match phase headings (phases 3, 5, 6)

- **Severity**: ❌ CRITICAL (mechanical contract)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress section
- **Detail**: `### Phase N: <name>` must match `## Phase N: <name>`; phases 3, 5, 6 dropped their title suffixes.
- **Fix**: Extend the three Progress headings to the full phase titles.
- **Decision**: FIXED

### F3 — Phase 6 drill's "trivial change" may not roll the container

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 6, item 1
- **Detail**: The container rolls out only when the image changes; a Worker-only trivial merge can leave the digest identical and deliver no SIGTERM — the drill "passes" by never firing.
- **Fix**: Require the drill merge to change the image (e.g. a comment edit under `services/solver/`).
- **Decision**: FIXED

### F4 — Force-exit footnote inverted; double Ctrl-C aborts the tier-1 drill

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details + Phase 2 manual drill
- **Detail**: uvicorn 0.52.1: a second **SIGINT** sets `force_exit` and skips the lifespan (`server.py:301,344-345`); a second SIGTERM does not. Plan stated the opposite; the tier-1 drill uses Ctrl-C.
- **Fix**: Correct the footnote; "press Ctrl-C exactly once" added to the drill step.
- **Decision**: FIXED

### F5 — Explicit `renewActivityTimeout()` in the override is redundant

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3, item 1
- **Detail**: The SDK calls `renewActivityTimeout()` itself after the override returns (`container.js:1569`); the `containerFetch` probe renews too. "Not stopping" is the mechanism.
- **Fix**: Plan now states the SDK re-arm fact; explicit call optional, documented as non-load-bearing.
- **Decision**: FIXED

### F6 — Line-pins drifted; indicator change has more consumers than listed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 success criteria; Phase 4, item 4
- **Detail**: Claim-filter pin is at `test_service.py:135-138` (assertion `:167`), not `:142`. `GenerationIndicator`/`describeGenerationIndicator` are also consumed by `PlanIndicatorsCell.tsx`, `use-generation-indicators.ts`, `job-progress-store.ts`, `api/loader.ts`, `api/plans-client.ts`, `PlansHub.tsx`.
- **Fix**: Pins corrected; consumer surface listed in Phase 4.4.
- **Decision**: FIXED
