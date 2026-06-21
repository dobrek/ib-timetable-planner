<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Bi-weekly Week-Aware Validation

- **Plan**: context/changes/bi-weekly-week-aware-validation/plan.md
- **Mode**: Deep
- **Date**: 2026-06-21
- **Verdict**: REVISE → SOUND (after triage; all 7 findings fixed in the plan)
- **Findings**: 1 critical · 4 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING (F3) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (F1, F6) |
| Plan Completeness | WARNING (F2, F4, F5, F7) |

## Grounding

28/28 paths ✓, symbols ✓, brief↔plan ✓. Demo viability verified: dp1 students pick both EE & CAS
(52 choice lines), so the `course_overlaps` projection (`load-cohort-courses.ts:65`) injects EE's
students into CAS's `studentKeys` → `hasIntersection(CAS, EE)` holds → they form a real soft pair.

## Findings

### F1 — Board-load query never reads placements.week (or opposite_week)

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §5 / Phase 2 §1 / Phase 3 §5 (omitted file)
- **Detail**: `plan-detail/api/load.ts:54` selects only `id, course_id, day, period` and maps
  PlannerPlacement at `:74-79` — no `week`. The plan threaded week through the action path
  (`api/placements.ts`) but never named `load.ts`, the board's initial hydration. So on every
  load/reload placements arrive week-less; Phase 2's relaxation reads `placement.week` via
  `bucketByCell → weekByCourseId` and either collapses to "both" (feature silently off) or treats
  undefined as disjoint (hides real collisions). Phase 5 lanes also need `placement.week`. The seed
  creates no placements, so Phase 2's own manual verification couldn't be performed as written. Same
  for `course_groupings.opposite_week` (read path is also `load.ts`).
- **Fix**: Add `load.ts` to Phase 1 §5 (select+map `week`) and Phase 3 §5 (select+map `opposite_week`).
- **Decision**: FIXED (Fix in plan)

### F2 — Plan cites a superseded replace_cohort_groupings migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness / Architectural Fitness
- **Location**: Current State (plan:29) / Phase 3 §4
- **Detail**: The plan pointed to `20260604141213_replace_cohort_groupings_fn.sql` (`p_cohort_id uuid`
  + dropped `cohort_id` column). The LIVE function was redefined in
  `20260611180006_plans_as_domain_root.sql:133-169` (`p_cohort public.cohort` enum, column `cohort`) —
  which `persist.ts:28` actually calls. Same stale-migration class the plan already caught for
  clone_plan. Copying the dead body fails at `db reset`.
- **Fix**: Base the Phase 3 `create or replace` on `20260611180006:133-169`; correct the Current State
  citation.
- **Decision**: FIXED (Fix in plan)

### F3 — Single bi-weekly drop defaults week="both", breaking the invariant

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment / Blind Spots
- **Location**: Phase 5 §2–§3
- **Detail**: Invariant is "agnostic ⇒ both; biweekly ⇒ a|b", but `createPlacementInput.week` defaults
  to "both" and only group drops assign a/b (Phase 5 §3). A bi-weekly course dropped individually lands
  as "both". Also SlotCell Props expose `occupants`+`names` only (no `weekMode`; verified
  `SlotCell.tsx:15-34`, PlacedChip `:185-206`), so the per-chip control can't tell a course is
  bi-weekly.
- **Fix (chosen: Fix B)**: Auto-assign at drop — the create/add path reads `weekMode` from the board
  catalog and resolves a bi-weekly single drop to `week="a"` (default; optionally first-free week); the
  per-chip control gates on `placement.week ∈ {a,b}`, so no `weekMode` prop is threaded into SlotCell.
- **Decision**: FIXED (Fix B)

### F4 — setWeek optimistic wiring omits the two files it actually lives in

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §6
- **Detail**: `usePlacements` is a thin orchestrator calling transport fns in
  `api/placement-client.ts` and delegating state transitions to pure fns in
  `model/placement-transitions.ts`. The plan said "mirror add/remove" but named neither file. Also
  `LocalPlacement` must carry `week` and the optimistic add must seed it (ties to F3).
- **Fix**: Phase 1 §6 names all three files + `setWeek*` pure transitions + `LocalPlacement.week`
  default seeding.
- **Decision**: FIXED (Fix in plan)

### F5 — Course read/write projection files for week_mode not named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §7 / Phase 4 §2
- **Detail**: The create/update mapping is `courses/api/course-record.ts` (`toCourseRecord`, :7-14) and
  the table-badge read needs `CourseRow.weekMode` hydrated in `courses/api/loader.ts` (select `:21`,
  map `:42-58`) — neither named; loader currently selects only
  `id, cohort, name, level, group_index, hours_per_week`.
- **Fix**: Phase 1 §7 names both files (toCourseRecord adds `week_mode`; loader selects + maps it).
- **Decision**: FIXED (Fix in plan)

### F6 — Reusing scoreVariant double-counts shared students for soft pairs

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3
- **Detail**: `coverageCount = Σ studentKeys.length` (`score.ts:12`) equals distinct count only when
  members are student-disjoint (true-parallel). An opposite-week pair shares students by construction,
  so it over-counts and inflates rank (`compareVariants` sorts on coverageCount) and display. Research
  Open Q3 flagged this; the plan resolved it as "reuse" without analyzing the double-count.
- **Fix (chosen: distinct union)**: For `oppositeWeek` variants compute `coverageCount` as the distinct
  student union; add a unit test (N shared students → coverageCount === N, not 2N).
- **Decision**: FIXED (Fix: distinct union)

### F7 — database.types regeneration command not specified

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3
- **Detail**: "Regenerated, not hand-edited" with no command, and no `gen:types` package script.
- **Fix**: Add `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`.
- **Decision**: FIXED (Fix in plan)
