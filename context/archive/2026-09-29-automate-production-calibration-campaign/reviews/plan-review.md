<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Automate the Production Calibration Campaign

- **Plan**: context/changes/automate-production-calibration-campaign/plan.md
- **Mode**: Deep
- **Date**: 2026-09-30
- **Verdict**: REVISE → SOUND after triage (all eight findings fixed in the plan)
- **Findings**: 1 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict (before triage) |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

30/31 paths ✓ (`GenerationStatusStrip.tsx` named by file only; it is at `src/_pages/plan-detail/ui/chrome/`), 14/14 symbols ✓, brief↔plan ✓, `wrangler secret bulk` null-delete ✓, `wrangler deploy --message` ✓, `clonePlan(includeBoard)` / `deletePlan` actions exist ✓, solver PATCH writes SELECT-less columns today (`return=representation` with a narrow `select=`) ✓, `getState()` does not start the container ✓, `checkPlan` returns the active source job and delivers on the proposal id ✓, one active job per source plan (partial unique index) ✓.

## Findings

### F1 — A cell switch never forces the cold start it depends on

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §5 Cell controller, §6 Guards; Phase 5 §4 Drill step 1
- **Detail**: `envVars` is read only at a real container start (`@cloudflare/containers` `container.js:1327`) and the SDK constructor re-arms the sleep timer on every Durable Object reset (`:359-360`), which a secret change causes. The plan's apply-cell was secret bulk + poll `status()` and never called `stopIfIdle`, so the first run after every switch would solve under the old cell, be excluded as "wrong cell", be retried on the same warm container, and halt.
- **Fix**: Apply-cell is one sequence: secret bulk → `status()` reports the cell → `stop-if-idle` → `status()` reports `running: false` → dispatch. The wrong-cell retry runs the stop first; `run-one` and drill step 1 use the same sequence.
- **Decision**: FIXED

### F2 — Production-only facts leak past the CellController seam

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 failure policy, §6 guards; Phase 5 §5 renewal
- **Detail**: "Non-container host → excluded" would exclude every local rehearsal run; "the Worker's live version" had no source; the renewal precondition on `sleepAfter` had no source since `status()` did not return it.
- **Fix**: `expectedHost` predicate and `liveVersion()` on the controller (production: container fingerprint, `wrangler deployments list --json`; local: accept anything, fixed string); `sleepAfter` added to the `status()` payload.
- **Decision**: FIXED

### F3 — Cell D has no input path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2 definition, §6 commands
- **Detail**: Cell D was "supplied by the human after the pause" but no command or journal entry carried it.
- **Fix**: `set-cell D <workers> <stageS> <modeAS>` command, validated against `effectiveTuning`'s bounds, journaled; `run` resumes from it; covered by `nextStep` tests and the rehearsal table.
- **Decision**: FIXED

### F4 — Session loss arrives as 401 JSON, not a redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §4 HTTP client
- **Detail**: `src/middleware.ts:8-11` lists `/_` as a public prefix, so `/_actions/*` never gets the 302; `requireSession` throws `ActionError UNAUTHORIZED` (401 JSON). Success responses are `application/json+devalue`.
- **Fix**: Session-lost keyed on the `UNAUTHORIZED` code; redirect handling limited to the sign-in POST; 401 path in the error-mapping tests.
- **Decision**: FIXED

### F5 — The ledger JSON is the only record and it lives on one laptop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §8 state directory; Critical Details, cleanup order
- **Detail**: Cleanup cascades the job rows, after which the gitignored merged ledger was the sole complete record. The plan itself asserts the ledger is ids and numbers only.
- **Fix A ⭐ Recommended**: Commit the merged ledger JSON to `context/changes/production-calibration-campaign/ledger.json`; `cleanup` refuses until the copy exists.
  - Strength: S-309's baseline comes from a versioned file; matches the plan's own claim.
  - Tradeoff: one more artifact to check for names; cleanup gains a precondition.
  - Confidence: HIGH — the ledger fields are enumerated in Phase 3 §2 and none is a name.
  - Blind spot: raw telemetry stays local; only the merged ledger moves.
- **Fix B**: Keep it local; cleanup refuses until a copy exists at an operator-named path outside `.campaign/`.
  - Strength: no repo policy change.
  - Tradeoff: still one machine; S-309's baseline stays a paste.
  - Confidence: MEDIUM.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A

### F6 — Drill steps 8–9 leave the accounting and the applied cell open

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §4 Drill, steps 8–10
- **Detail**: Step 9 applied "a cell" without saying which; whether the step-8 job counted was unstated; its ~45 min was missing from change.md's budget.
- **Fix**: Step 8 is journaled as Cell C run 1 (valid when `solver_config` matches, excluded otherwise); step 9 applies Cell A so the renewal command needs no further switch; change.md's budget table gained the row.
- **Decision**: FIXED

### F7 — Three unspecified points an implementer would have to guess

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §7 route; Phase 3 §4 remaining hours
- **Detail**: The route handler had no file path; "404 for everyone" ignored the middleware's 302 for unauthenticated requests; the remaining-hours mode claimed identity with Generate's loader, which the bench ESLint boundary forbids importing.
- **Fix**: Handler at `src/solver-container-route.ts`; 404 row reworded; remaining hours cited to the `bench/experiment-harness.ts` path (`loadPlanAnalysis` + `assembleGeneratorSnapshot` + `deriveCompleteness`).
- **Decision**: FIXED

### F8 — Node type-stripping is a trap the unit tests will not catch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4, `bench/campaign/*.ts`
- **Detail**: The runner runs under Node's native stripping while its tests run under vitest with the `@/` alias, so a value import of a type passes tests and fails at `node`.
- **Fix**: Runtime rule stated in Phase 4 (`import type`, erasable syntax only, `.ts` on relative imports); criterion 4.7 runs `status` through bare `node`.
- **Decision**: FIXED
