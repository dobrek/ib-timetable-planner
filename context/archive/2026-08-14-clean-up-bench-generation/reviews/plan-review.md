<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Retire the CI generation benchmark and the orphaned client generation path

- **Plan**: context/changes/clean-up-bench-generation/plan.md
- **Mode**: Deep
- **Date**: 2026-08-14
- **Verdict**: REVISE → SOUND after triage (all findings fixed in the plan)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (resolved) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING (resolved) |

## Grounding

13/13 paths ✓, all key symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓.

Deep verification (sub-agent): `applyGenerated` reachability CONFIRMED orphaned — no caller and no test exercises it (`use-cohort-board-state.test.tsx` imports only `indexFromPlacements`/`useCohortBoardState`/`useCombinedBoardState`); barrel client-safety trap CONFIRMED (31 client `.tsx` importers of `@/entities/timetable`, `client:load` at `PlanDetailPage.astro:37`); both `applyGeneratedPlacements` twins and `applyGeneratedRegion` CONFIRMED as described; `GenerationSummary` consumers all inside the deletion set; `bench/` IS type-checked by `pnpm check` (tsconfig `include: "**/*"`) but has zero real imports into the deleted path — `bench/generation.experiment.ts:39` is comment-only; `run.ts` survivors confirmed (`generation-delivery.ts:132` + its own unit test).

## Findings

### F1 — Phase 4's grep criteria are unsatisfiable, and roadmap.md:233 is a missed stale claim

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 4 — Success Criteria 4.1/4.2 + item 2
- **Detail**: Criteria 4.1/4.2 grepped all of `context/foundation/`, but `shape-notes.md` (:384, :549) keeps both phrases by design (annotate-only, bodies unchanged) — the phase could never pass its own gate. The grep also exposed `roadmap.md:233` (S-309 Risk line: "until this slice, greedy remains the working Generate affordance untouched") as a genuinely missed stale claim outside the two roadmap lines the contract edited.
- **Fix**: Added `roadmap.md:233`'s stale clause to Phase 4 item 2's contract; scoped criteria 4.1/4.2 (and their Progress rows) to `prd.md` + `roadmap.md` with the shape-notes carve-out stated.
- **Decision**: FIXED

### F2 — Criterion 1.2 fails on four stale comments outside Phase 1's contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Changes Required + Success Criterion 1.2
- **Detail**: Criterion 1.2's repo-wide grep for `bench:generation` hits `generation-smoke.test.ts:9` and `engines/greedy/search.test.ts:11` (blocking the gate); `vitest.experiment.config.ts:10` and `vitest.analyze.config.ts:9` cite `vitest.bench.config.ts` and would survive as false statements. All comment-only; D6 untouched.
- **Fix**: Added Phase 1 item 5 "stale comment sweep" listing the four locations.
- **Decision**: FIXED

### F3 — `use-generation-job.ts:10` comment breaks criterion 2.1 and was missing from the re-anchor list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — item 5 + Success Criterion 2.1
- **Detail**: The live CP-SAT hook's docblock names `useGeneratePlan`; criterion 2.1 greps src/ for that symbol and requires zero hits, but the file was absent from item 5's re-anchor list.
- **Fix**: Added `use-generation-job.ts:10` to Phase 2 item 5 with a reword instruction.
- **Decision**: FIXED

### F4 — Import-prune forecast resolved; `toSnapshotInput` local-helper cascade named

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details — excision order
- **Detail**: All symbols hedged as "must be checked" verify as fully unused after the excision; the `:11` import line survives for `deriveGenerationDeficits` + `CellCollisions`. `toSnapshotInput` is a local helper (`:203-210`), not an import — deleting it cascades `CohortSnapshotInput`/`GroupingCourse`/`LocalParkedBundle`; `LocalPlacement` stays (used `:244`).
- **Fix**: Replaced the hedge with the verified per-symbol forecast.
- **Decision**: FIXED

### F5 — Greedy engine path cited incorrectly

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: What We're NOT Doing — first bullet
- **Detail**: Cited as `engines/greedy/**`; actual path is `src/entities/timetable/model/generation/engines/greedy/**`. The bullet is S-309's hand-off pointer.
- **Fix**: Corrected the path.
- **Decision**: FIXED
