<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-07 Bundle Holding Container ("Shelf")

- **Plan**: context/changes/bundle-holding-container/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-26
- **Verdict**: APPROVED (all findings triaged and fixed)
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gates re-run locally, all green: `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test` (618 passed, 1 todo), `pnpm test:integration` shelf suite (7/7). Integration + E2E full suites verified via Progress shas + CI on each push.

Both review sub-agents independently found zero critical or dangerous issues. The two-store atomic rollback, copy-before-delete ordering, `clone_plan` double-remap, RLS/anon-revoke posture, semantic-token discipline, and `localStorage` try/catch are all correct and test-backed.

## Findings

### F1 — Direct-park feature added post-plan; plan.md never amended

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260626120005_shelve_courses_fn.sql + `parkMembers` verb (use-placements.ts) + drop-hints.ts "parked" case + 2nd E2E test
- **Detail**: A secondary capability (park a palette grouping straight onto the shelf, no board round-trip) was built after the plan: new `shelve_courses` RPC (a 6th migration; plan said "Five"), `parkMembers` verb, course/grouping→shelf dispatch, 2nd durability spec. Documented in change.md notes + fully tested, but plan.md's Changes Required / What We're NOT Doing were never updated.
- **Fix**: Append a "Delta from plan (post-implementation)" addendum to plan.md recording the `shelve_courses` RPC, `parkMembers` verb, direct-park dispatch, drop-hints change, 2nd spec, and the drawer/card polish — promoting the change.md notes into the plan of record.
- **Decision**: FIXED — addendum added to plan.md (between References and Progress).

### F2 — shelve_bundle / shelve_courses mint an empty shelf header with no server-side guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability / Data integrity)
- **Location**: supabase/migrations/20260626120001_shelve_bundle_fn.sql:31-33, 20260626120005_shelve_courses_fn.sql:23-31
- **Detail**: Both RPCs INSERT the header unconditionally. An empty source cell / empty course array yields an orphan `shelf_bundles` row with zero courses — `load.ts` renders it as a ghost empty parked card that inflates the badge, removable only via ×. Emptiness was guarded only client-side; the `useLatest` one-render ref lag makes a rapid double "lift to shelf" a narrow real path to the unguarded RPC.
- **Fix**: New migration `20260626120006_guard_empty_shelf.sql` `create or replace`s both functions to `raise` when the source is empty — the transaction aborts (no orphan row minted) and the domain layer's existing `if (error)` path rolls the optimistic update back. Non-empty path byte-for-byte unchanged.
- **Decision**: FIXED — guard migration added; applied via `db reset`; shelf integration 7/7, lint/check clean. (First cut used return-null + a client `if (!data)` guard; switched to `raise` because the generated RPC type is non-null, which tripped `@typescript-eslint/no-unnecessary-condition`.)

### F3 — unshelve_bundle trusts the caller's cohort

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Data integrity)
- **Location**: supabase/migrations/20260626120002_unshelve_bundle_fn.sql:36
- **Detail**: `unshelve_bundle` forwarded `p_cohort` to `place_course` without checking it matched the shelf bundle's stored cohort, so a DP1 parked bundle could land on the DP2 board if a caller passed the wrong cohort. Safe today (client always passes the active board cohort; loader filters shelf rows by cohort) but matters for the S-06 two-cohort view. (`shelve_courses` genuinely receives the cohort to park *into* — a palette grouping has no inherent cohort — so nothing to derive there.)
- **Fix**: New migration `20260626120007_unshelve_bundle_derive_cohort.sql` `create or replace`s `unshelve_bundle` to read the stored cohort from the `shelf_bundles` row and use it; `p_cohort` retained only for signature stability (create-or-replace can't drop a param) and no longer trusted. Early-returns if the parked bundle no longer exists.
- **Decision**: FIXED — derive-cohort migration added; applied; shelf integration 7/7.

### F4 — shelf.ts re-declares dayField/periodField instead of reusing them

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/api/shelf.ts:12-13
- **Detail**: Plan said reuse `dayField`/`periodField`/`cohortSchema` from placements.ts. `cohortSchema` was reused, but `dayField`/`periodField` were copy-declared because placements.ts declared them const-without-export — two sources of one truth that can silently diverge if grid bounds change.
- **Fix**: Export `dayField`/`periodField` from placements.ts; import them in shelf.ts (drop the local re-declaration and the now-unused `GRID_BOUNDS` import).
- **Decision**: FIXED.

### F5 — "GroupingBox shell reused" comment is misleading

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx:16
- **Detail**: The card hand-rolls a GroupingBox-style shell (mirroring its classes) but the docstring said the "GroupingBox shell" is reused — implying component reuse that doesn't exist, which could mislead a future editor into deduping them.
- **Fix**: Reword the docstring to "a standalone component that mirrors GroupingBox's layout/classes (not the same component), as a neutral, week-aware variant."
- **Decision**: FIXED.
