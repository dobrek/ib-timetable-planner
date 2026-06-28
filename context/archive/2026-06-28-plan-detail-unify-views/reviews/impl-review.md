<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Unify plan-detail views (combined = the board, single = a focus mode)

- **Plan**: context/changes/plan-detail-unify-views/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-06-28
- **Verdict**: NEEDS ATTENTION → all findings triaged & resolved
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F3 — plan misidentified the parity tests; reconciled) |
| Scope Discipline | WARNING (F2 — post-plan SlotCellHost inline left dead code; cleaned) |
| Safety & Quality | WARNING (F1 cross-cohort course leak; F4, F5 observations) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS (lint/steiger/test/build/astro check all green) |

Automated gates re-run during review: `pnpm lint` ✓, `pnpm steiger` ✓,
`pnpm check` (astro check, 0 errors) ✓, `pnpm test` ✓ (695 pass post-fixes),
`pnpm build` ✓. `pnpm test:integration` not re-run (needs local Supabase;
plan item 4.2 records it green at 765dbb9).

## Findings

### F1 — Palette course dropped on the sibling column persists a foreign-cohort course

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/cross-cohort/drop-router.ts:44-51
- **Detail**: A cohort-free palette `course`/`grouping` drag adopted the TARGET cell's cohort unconditionally, with no membership check downstream (`canAdd` only checks occupancy; the DB `placements_course_fkey` is plan-scoped, not cohort-scoped). In combined view the sibling column is droppable (only dimmed), so dragging the active cohort's palette course onto the other column persisted e.g. a DP1 course as a DP2 placement. Pre-existing (combined board + router predate this change); plan put the constraint core out of scope. Note: the prior behavior was deliberately tested (`drop-router.test.ts:49,59`) and documented in the router docstring as "adopt the target cell's cohort".
- **Fix B applied**: Guard the course/grouping cell path in `resolveCombinedDrop` — a palette drag now places only on an `activeCohort` cell; a drop on the OTHER column is rejected (`null`), symmetric with the relocating-drag cross-cohort guard. Shelf-park path unchanged. Updated the router docstring; rewrote the 2 tests to assert the new reject-on-wrong-column behavior.
- **Decision**: FIXED via Fix B (reject-on-wrong-column semantics, user-confirmed)

### F2 — Post-plan SlotCellHost→PlannerGrid inline left `useCellWiring` dead

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plan-detail/ui/grid/use-cell-wiring.ts, ui/grid/index.ts:4, ui/grid/PlannerGrid.tsx:17
- **Detail**: Commit 02f1d8d (after the plan epilogue) inlined SlotCellHost into PlannerGrid, which now destructures `column.wiring` inline; `useCellWiring` became production-dead (only its own test + the barrel referenced it). PlannerGrid's docstring still pointed at `useCellWiring`. (The plan's "What We're NOT Doing" deferred folding SlotCellHost into SlotCell; this folded it into PlannerGrid — adjacent, benign, tests stayed green.)
- **Fix applied**: Deleted `use-cell-wiring.ts` + `use-cell-wiring.test.tsx` + the barrel export; kept the `CellWiring` *type* (still used). Folded the hook's "why a single wiring prop, not Context" rationale into the `CellWiring` docstring in PlannerGrid so it isn't lost.
- **Decision**: FIXED

### F3 — Plan 4.7 misidentified the "parity" tests; impl correctly kept them

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/plan-detail/api/parity.test.ts, api/adapter-parity.integration.test.ts
- **Detail**: Plan Phase 4.7 + change.md "Safety net" called these "loader-parity" tests and instructed deleting them. They are not: `parity.test.ts` checks `computeGroupings` vs a golden CSV; `adapter-parity.integration.test.ts` checks the Supabase catalog adapter vs the fixture adapter (`course_overlaps` direction). Both are orthogonal live coverage. The implementer correctly retained them; the production read-boundary coverage was migrated separately (load/reload-restore → `loadCombinedPlannerData`). The plan text was just wrong and could mislead a future deletion.
- **Fix applied**: Updated plan.md (Critical Implementation Details bullet, Phase 4 §7, Testing Strategy) + change.md "Safety net" to record the files were kept as orthogonal coverage, not loader-parity guards.
- **Decision**: FIXED (plan reconciled; implementation was correct)

### F4 — `applyDropAction` switch has no exhaustiveness guard

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts:40-73
- **Detail**: The switch was exhaustive over the 8 CombinedDropAction kinds, but the function returns void with no `default`, so a future 9th kind would compile as a silent no-op (unlike the sibling `resolveCombinedDrop`, TS-enforced-exhaustive via its `| null` return).
- **Fix applied**: Added `default: { const _exhaustive: never = action; void _exhaustive; }`.
- **Decision**: FIXED

### F5 — "Zero per-drag cost / hidden cohort memoizes away" claim was overstated

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: plan.md Performance Considerations; src/_pages/plan-detail/model/use-cohort-board-state.ts:48-58
- **Detail**: In focus mode the orchestrator still ran BOTH cohorts' derivations; the hidden cohort's `freshIndex` tracked the VISIBLE cohort's live placements, so each completed drop re-ran the hidden cohort's collision pass once (never rendered). Not per drag-tick and within the 200ms budget, but "zero cost" was inaccurate.
- **Fix applied (Optimize too)**: `useCombinedBoardState(dp1, dp2, focus)` now feeds the HIDDEN cohort its static seed index instead of the visible cohort's live placements, so its collision/drag-hint memos stay cached across edits — the hidden cohort genuinely costs nothing per drop. Hook count stays constant (only the index *input* differs); `focus = "combined"` (default) keeps both indices live, so combined mode is byte-identical. Corrected plan.md Performance Considerations + the hook docstring/comment.
- **Decision**: FIXED + OPTIMIZED
