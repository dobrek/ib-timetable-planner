<!-- PLAN-REVIEW-REPORT -->
# Plan Review: The Proposal Is a Plan (S-306)

- **Plan**: context/changes/drift-decided-delivery/plan.md
- **Mode**: Deep
- **Date**: 2026-08-28
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in plan)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL (fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding
24/24 paths ✓, 14/14 symbols ✓, brief↔plan ✓; Progress↔Phase 5/5 headings, 27/27 rows ✓

## Findings

### F1 — A delivered proposal never runs checkProposal again

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §3 vs Phase 3 §6 / Phase 4 §3
- **Detail**: Non-pending plans took "today's path" (`checkGeneration` keyed by `plan_id`), so a delivered proposal never got its provenance strip and `notified_at` was never written — the hub "Ready" badge never cleared.
- **Fix A ⭐ Recommended**: One dual-keyed `checkPlan({planId})` (`plan_id OR proposal_plan_id`, role-tagged) on every visit; precedence rule defined; `checkGeneration` deleted.
- **Fix B**: Also call `checkProposal` on non-pending visits (two round trips per board load).
- **Decision**: FIXED via Fix A

### F2 — Deleting the SOURCE mid-solve strands the proposal read-only forever

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §5
- **Detail**: `generation_jobs.plan_id` is `on delete cascade` (20260810200122:60). Guards covered only the proposal; deleting the source deletes the job row and leaves the clone pending with no job.
- **Fix A ⭐ Recommended**: `deletePlan` refuses when the plan is `plan_id` of an active-and-not-stale job (`assertNoActiveJob`); "no referencing job" counts as terminal so stranded clones stay deletable.
- **Fix B**: FK `on delete restrict` + 23503 mapping.
- **Decision**: FIXED via Fix A

### F3 — Deleting a "Finished — open to deliver" proposal reports as a failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §5, Phase 4 §1–2
- **Detail**: `proposal_plan_id` is `on delete set null`; `deliver()` on a null proposal calls `failJob` (generation-delivery.ts:162-168), so a deliberate delete surfaced as a failure strip + `toast.error`.
- **Fix A**: Allow delete; render the resulting failure as nothing (error-string match).
- **Fix B ⭐ Recommended**: Refuse delete while deliverable-but-undelivered; message "open the proposal to deliver it first". Shared `deliverable` predicate.
- **Decision**: FIXED via Fix B

### F4 — `GenerateButton` has no `disabledReason` prop

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §6
- **Detail**: The reason is read off `generation: GenerationControls`; the union `GenerationDisabledReason` lives in `use-cohort-board-state.ts:140`.
- **Fix**: Spell out extending the union with `"generating"`, deriving it from the tracked job, and the button label.
- **Decision**: FIXED

### F5 — Two `STATUS_COLUMNS` constants; loader duplicates `discoverActive`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3, Phase 4 §1
- **Detail**: `generation-delivery.ts:89` vs `generation-status.ts:29`; `loader.ts:83-95` inlines the active-jobs query.
- **Fix**: Name the file per edit; one shared query builder used by the loader and `discoverActive`.
- **Decision**: FIXED

### F6 — `notified_at` backfill recommended but in no phase

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Migration Notes vs Phase 2 §1
- **Detail**: The backfill line was only in Migration Notes.
- **Fix**: Added to the Phase 2 §1 contract.
- **Decision**: FIXED

### F7 — "Check package.json for the types script" — none exists

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: Prior schema changes ran `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`.
- **Fix**: Command written into the contract.
- **Decision**: FIXED

### F8 — E2E fixture thinner than the ~2 s integration fixture

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 §2
- **Detail**: One DP1 course vs 2 courses × 2 cohorts in `generation-proposal.integration.test.ts:51-72`; an empty cohort is an untested solver input.
- **Fix**: One course + one student per cohort.
- **Decision**: FIXED
