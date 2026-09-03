<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Solve-policy choice (S-307)

- **Plan**: context/changes/solve-policy-choice/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in plan.md on 2026-09-02)
- **Findings**: 1 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

33/33 existing paths ✓ (2 declared-new absent as expected), 14/14 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (16 criteria ↔ 26 rows). All references checked at `240d640`.

Verified true (no finding): `_run_ladder` is order-parameterised and the clique cut is identity-keyed (`idx == 2`); `solve_repair` builds its own `SolveConfig` so `ladder` cannot leak; tier 5 = `studentHoles` so `(1,5,2,3,4,…)` is the POC order; `tierLabel` is keyed by stage name and `deriveCleanLabel` finds tier 5 by identity, both order-safe; `run_job` holds the raw request, so the runner seam is reachable; the golden regeneration command reproduces byte-identically (the result golden is already canonical, the seed dump is tracked); zod is already used in `entities`; `AlertDialog` / `ToggleGroup` / `Form` primitives exist.

## Findings

### F1 — "stage N of 10" prints the TIER, so a permuted ladder counts backwards

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Key Discoveries ("every 'stage N of 10' reader survives unchanged"), Desired End State ("stage 3 of 10 · student holes"), Phase 4 manual 4.4
- **Detail**: The row's `stage_index` is the tier IDENTITY, not the ladder position, by documented design: `runner.py:341-347` ("TIER numbers … never positions"), `test_service.py:541` ("TIER numbers, in order"), and the view type (`generation-delivery.ts:111` "The TIER now running"). All four readers print it verbatim beside `LADDER_TIER_COUNT`: `plan-indicators.ts:196`, `PendingProposalPage.tsx:168`, `GenerationStatusStrip.tsx:189`, `StopAndKeep.tsx:137`. Under student-first the hub shows "stage 2 of 10 · holes" → "stage 6 of 10 · student holes" → "stage 3 of 10 · total slots" → 4 → 5 → 7…; the promised "stage 3 of 10 · student holes" cannot be produced by any phase and the counter regresses. Research C5 carries the same positional misreading. `StageEvent` already carries `position`/`total`, documented as "the human count" (`solve.py:71-74`); the runner writes `event.tier` instead.
- **Fix A ⭐ Recommended**: Write the ordinal onto the row — in Phase 2 §3 `_progress_payload` writes `stage_index = event.position` and `checkpoint_stage_index = event.position`; `_stop_error` names the position (`len(stages)`) instead of `last.tier`; rewrite the docstring at `:341`, the `test_service.py:541` assertion text and the TS doc comments (`generation-delivery.ts:109-111`); add a Phase 2 pin that under student-first `stage_index` runs 1..10 while `stage_name` follows the permutation.
  - Strength: Zero app-side change; monotonic under every policy; the four readers already mean the ordinal; canonical rows are byte-identical (position == tier).
  - Tradeoff: Redefines two smallint columns' semantics without a migration; the checkpoint's TIER is no longer on the row (it stays in `stages[].tier`, which clean-label reads).
  - Confidence: HIGH — every consumer grepped; none correlates `stage_index` with `stages[].tier`; `job-delivery.ts` uses only null-ness.
  - Blind spot: The `generation_jobs` migration comment (`:87-91`) may describe the column as a tier; true it up in Phase 5.
- **Fix B**: Keep tier identity; `policy.ts` also owns preset → ladder order and a `stagePosition(policy, tier)` helper feeds the four readers; the hub projection (`generation-status.ts:38`, `plan-indicators.ts`, `job-progress-store.ts` `sameIndicators`) gains `policy`.
  - Strength: Row semantics untouched; the tier stays queryable.
  - Tradeoff: Duplicates the ladder table on both sides (needs a parity test vs Python `PRESETS`), touches 5+ more files, pulls `policy` into the hub projection the plan says it will not touch.
  - Confidence: MEDIUM — works, but it is the "two copies that can drift" shape the plan argues against.
  - Blind spot: Legacy rows read as clean, so historical positions are right by accident only.
- **Decision**: FIXED — Fixed via Fix A

### F2 — Required `GenerationJobView.policy` breaks 11 view fixtures in 6 test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3 (view gains policy) and its Success Criteria
- **Detail**: "Existing callers omitting `policy` keep passing" is true of the Zod input, but `GenerationJobView` object literals exist in `StopAndKeep.test.tsx`, `PendingProposalPage.test.tsx`, `GenerateButton.test.tsx`, `GenerationStatusStrip.test.tsx`, `use-cohort-board-state.test.tsx` and `use-pending-proposal.test.ts` (11 literals). Two of those files appear nowhere in the plan; `pnpm check` (3.3) fails until all are updated.
- **Fix**: Name the six files in Phase 3 §3 with "add `policy: DEFAULT_SOLVE_POLICY` to each view fixture".
- **Decision**: FIXED

### F3 — Testing Strategy contradicts Phase 3 §5 on which gate reads `cleanRequested`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy › Unit Tests (app)
- **Detail**: Phase 3 §5 says `sameCleanLabel` compares `cleanRequested` and `sameView` compares `policy.preset`; the Testing Strategy says "`use-pending-proposal.test.ts` — `sameView` notices `cleanRequested`".
- **Fix**: "`sameCleanLabel` notices `cleanRequested`; `sameView` notices `policy.preset`".
- **Decision**: FIXED

### F4 — CLI flag's stated rationale points at the wrong transport

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Overview, Phase 2 §4, plan-brief "CLI flag" row
- **Detail**: "Exposed on the CLI so the hosted campaign can vary it" — the campaign (`mise run solver:hosted`) dispatches through the app and the service, where the dialog varies the policy. The flag is still worth its ~15 lines (POC-frontier reproduction from the file transport; `test_cli.py` is the first test on the CLI, the POC's recorded lesson) — the reason is misattributed.
- **Fix**: Reword to "so the POC frontier is reproducible from the file transport"; drop the campaign clause.
- **Decision**: FIXED

### F5 — Phase 5 misses the roadmap summary row and the research misreading

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §2
- **Detail**: `roadmap.md:40` (slice table) still says "trade-off dial", vocabulary the plan's copy discipline (C4) rejects; §2 names only the S-307 section. Research C5 asserts the positional reading F1 falsifies — worth a one-line correction in research §8 so the next consumer does not inherit it.
- **Fix**: Add both to Phase 5 §2's contract.
- **Decision**: FIXED
