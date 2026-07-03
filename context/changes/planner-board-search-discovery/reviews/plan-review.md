<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Planner Board Highlight/Discovery Lens

- **Plan**: context/changes/planner-board-search-discovery/plan.md
- **Mode**: Deep
- **Date**: 2026-07-03
- **Verdict**: REVISE → SOUND (all six findings fixed during triage)
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (fixed) |
| Plan Completeness | WARNING (fixed) |

## Grounding

11/11 paths ✓, 14/14 symbols ✓, brief↔plan ✓. Deep verification: 6/7 risky claims CONFIRMED with file:line evidence, 1 PARTIAL (placement ids are remapped on server reconcile and on undo/redo — safe only because the matched Set lives in a per-render memo, which the plan specifies).

Notable confirmations: `teacherNames`/`studentNames` already reach the island (`model/drag.ts:46,58`, loader `api/load.ts:91-95`) so "no new fetch" holds; inspection dialog state is shell-owned (`PlannerBoard.tsx:79`); ⌘K is unbound (only ⌘B in `SidebarLayout.astro:176-182` and ⌘Z in `use-undo-keymap.ts`); the state-shape test asserts selected fields only; `PlacedChip` has no consumers outside the grid path; `BoardShell.header` accepts a fragment and spans the full width.

## Findings

### F1 — Progress section deviates from the format contract

- **Severity**: ❌ CRITICAL (format contract for /10x-implement)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress
- **Detail**: (a) Progress phase titles didn't match the body headings (worst: "Session persistence + e2e" vs "Persistence + E2E"). (b) Manual bullets weren't 1:1 with rows: Phase 3 had 4 bullets → 3 rows, Phase 4 had 3 bullets → 1 row; per-row SHA write-back and the final-phase manual rollup can't represent partially-done merged checks.
- **Fix**: Align the four Progress phase titles with the body headings; split 3.5 into two rows and 4.4 into three rows matching the manual bullets.
- **Decision**: FIXED

### F2 — LensBar unmount contradicts the "always-mounted" live region

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — #2 (LensBar) vs #3 (shell placement)
- **Detail**: The "always-mounted" role=status live region was specified inside LensBar, which itself unmounts at zero criteria — silencing the first-criterion and lens-cleared announcements. Preview announcement behavior was unspecified (per-arrow spam risk).
- **Fix**: Live region hoisted to the shell, permanently mounted; announces committed-criteria changes only (match total / "lens cleared"), never preview changes.
- **Decision**: FIXED

### F3 — Pruning universe said "visible", breaking off-screen criteria survival

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — #2 Rehydrate + write-through
- **Detail**: Rehydrate pruned teachers against the "visible teacherKeys universe", contradicting the locked ·0-chip decision — a DP1-focused rehydrate would prune a DP2-only teacher.
- **Fix**: Prune against both cohorts' catalogs' `teacherKeys` (the union the loader builds for `teacherNames`, `api/load.ts:91-95`); "never the visible-cohort subset" now explicit.
- **Decision**: FIXED

### F4 — Esc-clear guard: three overlays shell-invisible, no fallback named

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (Esc layering) / Phase 2
- **Detail**: The hours popover (`PlanSummaryBar.tsx:91`), `BoardSettingsMenu` dropdown, and `CoursesLeftPopover` keep open state invisible to the shell; focus ancestry was the only guard covering them and fails when focus sits outside the layer. No remedy was named for a manual-2.5 failure.
- **Fix**: Added a DOM-based open-layer veto (`[data-radix-popper-content-wrapper]` / `[data-state="open"]` query) alongside focus ancestry, plus the pre-decided escalation: lift a leaking overlay's open state to the shell, never weaken the guard.
- **Decision**: FIXED

### F5 — Two docblocks go stale; lessons rule makes updating them part of done

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 2–3
- **Detail**: `BoardShell.tsx:33` ("header is always PlanSummaryBar") and `PlanSummaryBar.tsx:25` (trailing = "the drag-hint toggle") both go/are stale. Also the state-shape test is `use-cohort-board-state.test.tsx`, not `.test.ts` as cited.
- **Fix**: Docblock updates added to Phase 2 #5 and Phase 3 #3 contracts; test filename corrected (both occurrences).
- **Decision**: FIXED

### F6 — effectiveCriteria merge/dedup was untested hook logic

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — #2 use-lens.ts / Testing Strategy
- **Detail**: The committed + preview merge with dedup feeding the derivation was pure logic living untested in a UI-layer hook, against the "pure domain logic in model/, hooks orchestrate" convention.
- **Fix**: `mergeEffectiveCriteria(committed, preview)` extracted to `model/lens.ts` with tests (dedup, no-preview passthrough); Phase 2 success criteria and Testing Strategy updated.
- **Decision**: FIXED
