<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Teacher Plan View Implementation Plan

- **Plan**: context/changes/teacher-plan-view/plan.md
- **Mode**: Deep
- **Date**: 2026-07-05
- **Verdict**: REVISE → SOUND after triage (all findings fixed)
- **Findings**: 2 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL (fixed in triage) |
| Plan Completeness | WARNING (fixed in triage) |

## Grounding

17/17 paths ✓, 6/6 symbols ✓, brief↔plan ✓. Also verified: `SidebarLayout.astro:24` nav prefix-highlight, `--color-warning` token in `global.css`, `@/*` tsconfig alias, shadcn `Dialog`/`DropdownMenu` in `shared/ui`, `subjectChipClass` at `subject-colors.ts:42`, violation-narrowing feasibility (all 5 `CollisionViolation` kinds carry course IDs), zero move-set importers outside `plan-detail`.

## Findings

### F1 — steiger `insignificant-slice` fails CI while the entity has one consumer

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 & 2 success criteria (`pnpm steiger`)
- **Detail**: The recommended steiger preset's `insignificant-slice` rule warns when a slice has exactly one referencing slice (verified in the plugin source), and CI runs `--fail-on-warnings`. Until `teacher-plan-view` lands in Phase 3, `entities/timetable` has only `plan-detail` as consumer — Phases 1–2 could not pass their own steiger criterion. The plan's original "no phase leaves an unreferenced slice for steiger to flag" claim tested the wrong condition (zero consumers vs one).
- **Fix A ⭐ Recommended**: Files-scoped `insignificant-slice` override for `src/entities/timetable` in steiger.config.ts, added in Phase 1.
- **Fix B**: Merge Phases 1–3 as one PR, accepting red steiger between.
- **Decision**: FIXED (Fix A) — Phase 1 §5 added; "Steiger slice mechanics" bullet corrected.

### F2 — Phase 1 move set is not import-closed as specified

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — move table & staying list
- **Detail**: Four unmentioned entity→_pages leaks: (a) ~9 moved files import `GroupingCourse` via staying `grouping/grouping.ts` (a pure re-export of `@/shared/lib/catalog-hash`); (b) `cell-tone.ts` imports the editing-only `DropHint` type from staying `drop-hints.ts:19`; (c) six moved tests import `model/__fixtures__/builders.ts`, not in the move set; (d) `collision-parity.test.ts` / `collisions.perf.test.ts` value-import `deriveDropHints` and must stay behind.
- **Fix A ⭐ Recommended**: Amend inventory; drop `cell-tone.ts` from the move set (editing concept stays with editing machinery; the page derives shading from `CellCollisions` directly).
- **Fix B**: Amend inventory; move the `DropHint` type into the entity with cell-tone.
- **Decision**: FIXED (Fix A) — move table amended (builders.ts added, cell-tone removed to staying list), import-closure notes added.

### F3 — Merge parent→children mapping is not exposed by `loadCohortCourses`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Teacher-view loader contract
- **Detail**: `CohortCatalog` is `{ courses, courseDisplay, warnings }` — the parent→children mapping consumed at `load-cohort-courses.ts:48-84` is internal and never exposed; the new loader needs its own `course_merges` query. A merge child with no direct student choices is also absent from `courses[]`.
- **Fix**: Explicit `loadCourseMerges` fetcher (promoted to `shared/api` beside the other three); absent-child renders with empty roster.
- **Decision**: FIXED — Phase 3 §1 files list + loader contract updated.

### F4 — Inventory inaccuracies: phantom `model/grid.ts`, retarget count ~68 not ~40

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — staying list & §3 import retargeting
- **Detail**: `model/grid.ts` doesn't exist (`GRID_BOUNDS` is at `src/shared/lib/grid/grid.ts:10`); real retarget scope is ~68 staying files (~49 source + ~19 test) incl. the `ui/overlay/index.ts` barrel and four `CollisionInspectionTarget` deep-imports.
- **Fix**: Correct the staying list and estimate; name the overlay-barrel retarget sites.
- **Decision**: FIXED — grid.ts entry removed (with F2 edit), count + barrel note updated in plan and brief.

### F5 — Empty state expected by manual tests but specified by no phase

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Manual Testing step 4 vs Phase 3 UI contract
- **Detail**: Manual step 4 and the e2e spec assert an empty view for a courseless teacher, but no phase specified building it.
- **Fix**: One-line empty-state spec in the Phase 3 course-list contract.
- **Decision**: FIXED — line added.
