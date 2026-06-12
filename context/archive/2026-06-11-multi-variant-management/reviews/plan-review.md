<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Multi-Variant Management (Plans as Cloneable Domain Root)

- **Plan**: context/changes/multi-variant-management/plan.md
- **Mode**: Deep
- **Date**: 2026-06-11
- **Verdict**: REVISE → **SOUND after triage** (all findings fixed in-plan)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | FAIL → fixed (F1, F3) |
| Blind Spots | WARNING → fixed (F4, F6) |
| Plan Completeness | FAIL → fixed (F2, F5) |

## Grounding

16/16 paths ✓, 5/5 symbols ✓ (`computeCatalogHash`, `loadCohortCourses`, `teachers.code` UNIQUE, `courses_unique(cohort_id,…)`, empty `Enums`), brief↔plan ✓. The plan's "7 variantId touchpoints" claim verified exact by grep.

## Findings

### F1 — clonePlan's hash recompute requires a cross-slice import that fails the steiger CI gate

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details + Phase 4 #1
- **Detail**: Phase 4's `clonePlan` (in `_pages/plans-list/api/`) must call `loadCohortCourses` + `computeCatalogHash`, both in `_pages/plan-detail/api/` — a same-layer cross-slice import. steiger's `forbidden-imports` rule is error-level (verified in `@feature-sliced/steiger-plugin` recommended config), enforced by `steiger src --fail-on-warnings` in CI and by the lefthook pre-commit job. No `@x` convention exists in the repo; zero cross-slice `_pages` imports today. Phase 4 as written could not pass its own success criteria.
- **Fix A ⭐ Recommended**: Promote the hash machinery (`computeCatalogHash` + cohort-catalog projection, with their data types) to `shared/lib/catalog-hash/`
  - Strength: Matches the repo's only existing cross-slice-reuse pattern (`shared/` hosts `cohorts.ts` today); steiger-clean, no new conventions.
  - Tradeoff: Drags catalog-snapshot types down a layer; move must stay type-only at the `model/` boundary.
  - Confidence: HIGH — mechanical relocation, compiler-guided.
  - Blind spot: Exact type entanglement of `CatalogSnapshot`/`GroupingCourse` with `plan-detail/model` not traced.
- **Fix B**: Expose via FSD `@x` cross-import public API (`plan-detail/@x/plans-list.ts`)
  - Strength: Zero relocation; explicit documented dependency.
  - Tradeoff: Brand-new convention; `@x` is idiomatic on entities, unusual on page slices.
  - Confidence: MEDIUM.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — new Phase 3 #6 "Catalog-hash machinery to shared"; Critical Implementation Details and Phase 4 #1 updated.

### F2 — Progress section titles don't match phase headings

- **Severity**: ❌ CRITICAL (mechanical contract)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress
- **Detail**: Phase 3 and Phase 4 Progress subsection titles were shortened versions of the body headings; /10x-implement matches titles exactly. Checkbox items mapped 1:1 to success criteria (clean).
- **Fix**: Align the two Progress subsection titles with the full phase headings.
- **Decision**: FIXED — both titles expanded to match.

### F3 — "Reuse existing grid-preset definitions" — no such list exists, and the parser is in the wrong slice

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 #1 (createPlan contract)
- **Detail**: No list of valid presets exists anywhere — only `parseGridPreset` + `DEFAULT_GRID`/`GRID_BOUNDS` in `plan-detail/model/grid.ts:4-31`; DB column is plain text. Importing `grid.ts` from plans-list is the same steiger violation as F1.
- **Fix**: Define the canonical preset list in `src/shared/config/grid-presets.ts`; `plan-detail/model/grid.ts` and the createPlan dialog both consume it.
- **Decision**: FIXED — Phase 4 #1 contract and Files updated.

### F4 — Existing integration tests silently skip after the schema drop — masking the Phase 2/3 criteria

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 + Phase 3 test updates
- **Detail**: All three existing integration suites (`endpoint`, `adapter-parity`, `students-crud`) query the `cohorts` table in `beforeAll` with swallowed errors → after the drop they `ctx.skip()` instead of failing. Phase 2's "test:integration passes" criterion was green-but-vacuous; the plan listed only one of three files for update.
- **Fix**: List all three integration test files in Phase 3 #7; note the expected skip-not-fail behavior in Phase 2; require zero skipped tests in Phase 3's criterion.
- **Decision**: FIXED — Phase 2 criterion annotated; Phase 3 #7 lists all three files; Phase 3 criterion + Progress 3.3 now say "zero skipped tests".

### F5 — Phase 3 file lists understate the blast radius (~25 affected files not named)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 #1/#2/#3
- **Detail**: Grep found cohort-UUID symbols outside the plan's lists: catalog slices' `model/` segments (+tests), `load-cohort-catalog.ts`, `grouping-client.ts`, `ComputeGroupingsEmptyState.tsx`, `TeacherTable.tsx`, and the `shared/api/index.ts` barrel re-exporting from the to-be-deleted `cohorts.ts`. TypeScript catches all once the enum lands — risk was effort underestimation.
- **Fix**: Extend the file lists and add a "lists are representative — follow the compiler" note.
- **Decision**: FIXED — Phase 3 overview note added; #1, #2, #3 file lists extended.

### F6 — Manual checks assume DB states the seed never produces

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 manual verification / Manual Testing Steps
- **Detail**: The seed creates catalog rows only — no groupings, no placements. The warm-clone check (manual + integration) is vacuous unless groupings are computed on the source first; the blank-plan board exercises a never-rendered zero-course state.
- **Fix**: Prefix warm-clone steps with "compute groupings on the source plan first"; flag the empty-catalog board as a new code path.
- **Decision**: FIXED — Phase 4 #4 contract, Phase 4 manual verification, and Manual Testing Step 3 updated.

## Triage Summary

- Fixed: F1 (Fix A), F2, F3, F4, F5, F6 (6)
- Skipped: none
- Accepted: none
- Dismissed: none

**Verdict after fixes: REVISE → SOUND**
