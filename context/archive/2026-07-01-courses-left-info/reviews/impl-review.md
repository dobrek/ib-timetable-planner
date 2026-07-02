<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Courses Left Info — Hours-Based Breakdown

- **Plan**: context/changes/courses-left-info/plan.md
- **Scope**: Full plan (Phase 1 + 2 of 2)
- **Date**: 2026-07-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (12/12 files MATCH) |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS (e2e not re-run locally — needs stack) |

Automated gates re-verified green locally: `astro check` (0 errors), scoped unit tests, `lint`, `steiger`, `build`. The safety-critical invariants (non-netting; the `required>0` merge-child guard; referential stability; negative-hour impossibility) all hold and are regression-pinned. No residual `incompleteCount` / `countIncompleteCourses` / `data-incomplete` anywhere in `src/` or `e2e/`.

## Findings

### F1 — E2E spec uses [data-slot] CSS selectors against e2e convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/specs/courses-left-popover.spec.ts:34,39,44
- **Detail**: The spec located elements via `page.locator('[data-slot="plan-summary"]')`, `'[data-slot="courses-left-popover"]'`, `'[data-slot="hours-counter"]'`. `e2e/CLAUDE.md:37-38` bans CSS selectors ("Role-based locators first … Never CSS selectors, XPath, or DOM structure"). It was the only spec in `e2e/specs/` doing this. The trigger is a `<button>` with `aria-label "… — show breakdown"`, and the popover already asserts via `getByText`. The plan itself (§Phase 2.6 e2e contract) directed the data-slot hooks *and* said "follow existing spec conventions" — an internal tension the implementation resolved toward the literal data-slot instruction.
- **Fix**: Locate the trigger with `getByRole("button", { name: /show breakdown/ })` and the popover with `getByRole("dialog")` (Radix content role); read `data-hours-left` as an assertion off the resolved button; keep a `data-slot` locator only for `hours-counter` (no role/text equivalent), scoped inside the dialog.
- **Decision**: FIXED via Fix now

### F2 — `summary` left un-memoized while two sibling derivations use useMemo

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/PlannerBoard.tsx:186
- **Detail**: `buildCoursesLeftSummary(...)` runs inline (comment: "Auto-memoized by React Compiler"), whereas `overlayCourseDisplay` (:81) and `shelfCohortById` (:86) use explicit `useMemo`. Mitigating: React Compiler is enabled; the work is sub-ms and only re-runs on placement change (not per drag-frame); and `summary` sits directly beside `columns`/`cohorts`/`parkedBundles` (:181-183) which are ALSO inline — so it is consistent with its immediate neighbors. No threat to the <200ms drag budget.
- **Fix**: Optional — wrap in `useMemo` to match the upper neighbors, or leave as-is.
- **Decision**: SKIPPED

### F3 — `summarizeHours` re-derives the unplaced/over sets useHours already has

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/plan-detail/model/hours.ts:53-55
- **Detail**: `summarizeHours` internally called `deriveUnplaced(stats)` and `deriveOverplaced(stats)`, while `useHours` (`use-board-derivations.ts:70-72`) separately memoizes those same two arrays — so each `hours` change spread/filtered the stats Map ~4×. All O(N) over a small catalog and memoized per drop, so harmless; flagged only as a single-source-of-truth nicety.
- **Fix**: Have `summarizeHours` accept the already-derived `unplaced`/`overplaced` arrays and sum from them; the `required>0` guard stays in `deriveOverplaced`. Updated the one call site and three test call sites.
- **Decision**: FIXED via Fix now
