<!-- PLAN-REVIEW-REPORT -->
# Plan Review: POC — Local Python CP-SAT Solver (Backend-Service Shape)

- **Plan**: context/changes/poc-cp-sat-backend-service/plan.md
- **Mode**: Deep
- **Date**: 2026-07-15
- **Verdict**: SOUND (was REVISE; all findings fixed in triage)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS (1 observation, fixed) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → fixed |
| Plan Completeness | WARNING → fixed |

## Grounding

12/12 paths ✓ (4 cited as basename shorthand — real locations `src/entities/timetable/model/analysis/lanes.ts`, `model/collision/constraints/{early-finish-edge,teacher-day-shape}.ts`, `model/generation/engines/greedy/problem.ts`; all line refs verified), 9/9 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (5 phases, 25 criteria mirrored).

Deep verification (sub-agent, ~40 claims): tier order + all week/lane asymmetries, delta/pin semantics, snapshot sufficiency (nothing missing), harness seam/persistRegion semantics, per-cohort `lowerBound` population, and G2 metric identity (analyzer teacher gap-slots ≡ objective tier-4 `teacherHoles`, same `lanes.ts` primitive) all CONFIRMED against the code at `b55fabf`.

## Findings

### F1 — Pins participate in tiers and cross-row constraints; the plan never said so explicitly

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details / Phase 2–3
- **Detail**: TS `boardRows` = pins + generated of both cohorts (`objective.ts:116-133`) — softHits and hole spans count pinned rows. Early-finish-edge is blocking with no pin tolerance, so generated rows must not sandwich a pinned flagged row (golden dp2 has 9 flagged courses; the skeleton pins Advisory/CAS/EE/SSSTS). An encoding ranging only over generated rows passes pin-free micro-cases, then fails parity — or is silently under-constrained until the Phase 5 import verify.
- **Fix**: New Critical Implementation Details bullet (merged board, pins as constants inside expressions) + a pinned-row micro-case added to Phase 3 step 3.
- **Decision**: FIXED

### F2 — "Invisible to every CI gate" was false for prettier + lefthook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Current State Analysis + Phase 1, step 1
- **Detail**: `.prettierignore` didn't cover `poc/` — `pnpm format` and the lefthook pre-commit hook (staged `*.{json,md}`) would reformat the committed seed fixture and README on the very commit adding them. ESLint ignores follow `.gitignore` via `includeIgnoreFile`, so gitignored dirs are safe; a stray `.ts` under `poc/` would be typed-linted (tsconfig includes `**/*`).
- **Fix**: Phase 1 step 1 now also adds `poc/` to `.prettierignore`; Current State bullet corrected.
- **Decision**: FIXED

### F3 — Export's TS-tuple step underspecified scoreCandidate's contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1, step 2 (export experiment)
- **Detail**: `scoreCandidate(snapshot, generated, remaining, tiers = Infinity)` — tier 1 is read from the caller-supplied `remaining` map alone (`objective.ts:123-139`); a Candidate scored with `tiers ≤ SEARCH_TIERS (6)` carries zeros in tiers 7–10 (`objective.ts:43-46, :69`). Wrong inputs make the dump tuple silently wrong; the parity gate then fails pointing at Python.
- **Fix**: Export contract now pins: fresh call, default `tiers`, `remaining` built from the greedy outcome's per-cohort unplaced deficits.
- **Decision**: FIXED

### F4 — `--mode complete` vs `--mode full` overlap left G2's source board ambiguous

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 (Mode A contract) + Phase 5, step 2 (runbook)
- **Detail**: Mode A chains into the ladder on SAT (tier 2 onward), yet the campaign listed "Mode A → full ladder → Mode B" as separate steps; a separate full-mode run on a SAT instance wastes ~20 min and can yield a residue-carrying board, leaving G2's provenance to guesswork.
- **Fix**: Campaign intent + manual step 5 now state the branching: SAT → complete-mode ladder output is the G2 measurement and import board; `--mode full` only on UNKNOWN.
- **Decision**: FIXED

### F5 — Import re-assembled the snapshot instead of reading the dump's

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 5, step 1 (import experiment)
- **Detail**: Re-assembly from the clone + re-applied auto-park duplicated the transformation and added a drift failure mode; the dump (required `DUMP` input) carries the exact snapshot Python solved.
- **Fix**: Import now verifies against `dump.snapshot`; re-assembly demoted to an optional equality drift-check.
- **Decision**: FIXED

### F6 — G3's evidence source was split between seed and golden artifacts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5, step 3 (gates)
- **Detail**: G3 cited "a fabricated residue" (the seed Phase 4.5 artifact) while the campaign's Mode B runs on the golden board's real residue; which measurement backs the verdict was unstated.
- **Fix**: G3 gate text now names both: fabricated seed residue = gate evidence; golden 1-hop repair = recorded hybrid-architecture context (may legitimately fail if 1-hop-infeasible).
- **Decision**: FIXED
