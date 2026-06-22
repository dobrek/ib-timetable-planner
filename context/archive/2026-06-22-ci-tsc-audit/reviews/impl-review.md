<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: CI Type-Check Gate (astro check)

- **Plan**: context/changes/ci-tsc-audit/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS (1 observation) |
| Scope Discipline | PASS (1 observation) |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Live gate re-run at review time: `pnpm check` → 0 errors, lint clean, steiger clean, 458 tests pass. Build verified at Phase 1 (1beed2f); Phases 2–3 touched only config/docs that don't affect the build.

## Findings

### F1 — unwrap-row.ts uses a stronger contract than the plan stated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/shared/api/postgrest/unwrap-row.ts:6,9
- **Detail**: Plan specified `unwrapRow<T>(result: { data: T | null; … }): T` with `return result.data as T`. Implementation landed `unwrapRow<R extends { data: unknown; error: PostgrestError | null }>(result: R): NonNullable<R["data"]>` with `return result.data as NonNullable<R["data"]>`. Functionally equivalent and arguably better — mirrors the whole-result constraint of sibling `unwrap-maybe-row.ts`, clears the same 7 call sites, type-only. The `as` cast is sound: `.single()` never yields `data:null/error:null` (zero/multiple rows surface as PGRST116), so after the error guard the non-null assertion encodes an invariant PostgREST already guarantees. Still a deviation from the written contract.
- **Fix**: None needed — accept the deviation (sibling-consistent, sound).
- **Decision**: ACCEPTED — accepted as-is; stronger sibling-consistent variant, no code change.

### F2 — unwrap-maybe-row.test.ts changed but not listed in the plan

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/shared/api/postgrest/unwrap-maybe-row.test.ts:11
- **Detail**: One line changed — explicit generic `unwrapMaybeRow<{ hash: string }>({ data: null, error: null }, …)` became `unwrapMaybeRow({ data: null as { hash: string } | null, error: null }, …)`. Necessary call-site fallout from the planned C fix: the generic is now inferred from the whole result, so an explicit `<{ hash: string }>` no longer fits and `data: null` would otherwise infer `R["data"]` as `null`. The annotation restores the intended "zero rows → null" path. Test-only, no behavior change — justified, just not enumerated in the plan's file list.
- **Fix**: None needed — justified consequence of the planned C fix.
- **Decision**: ACCEPTED — accepted as-is; necessary call-site fix, no action.
