<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Student Plan View

- **Plan**: context/changes/student-plan-view/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-07-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations — all triaged & resolved

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gate re-run live during this review: `pnpm check` ✅ 0 errors · `pnpm lint` ✅ · `pnpm steiger` ✅ · `pnpm test` ✅ 958 · `pnpm build` ✅ · `pnpm test:integration` ✅ 74 · `pnpm test:e2e` (student spec) ✅ 2 passed. Plan drift: 14/14 planned changes MATCH (no MISSING, no DRIFT).

## Findings

### F1 — Student identity resolved from a capped, name-ordered list

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/student-plan-view/api/loader.ts:70-72 (+ :107)
- **Detail**: The viewed student was resolved by `students.find(row => row.id === studentId)` over `fetchPlanStudents`, which is `.order("full_name").limit(500)`. In a plan with >500 students, a valid member ranked alphabetically past the cutoff resolved to `undefined` → not-found → 404 on a direct valid URL. The plan specified this shape (mirror of the teacher loader), so it was a plan-design edge, not implementation drift — but students are the higher-cardinality entity, turning the cap into a silent-404 on valid data. It also coupled identity resolution to the switcher list.
- **Fix A ⭐ Recommended**: Resolve the viewed student with its own scoped single-row query (`.eq("id", studentId).eq("plan_id", planId).maybeSingle()`), independent of the capped list; keep `fetchPlanStudents` as the switcher list only.
  - Strength: Removes the silent-404 edge and tightens plan-scoping to the row itself; identity no longer depends on list order/cap. Same `.maybeSingle()` guard the plan lookup already uses.
  - Tradeoff: One extra round-trip (folded into the existing parallel batch); minor divergence from the teacher loader's single-fetch shape.
  - Confidence: HIGH — established PostgREST pattern in this very file.
  - Blind spot: The switcher list is still capped at 500; a truly large plan would also want a paginated/searchable switcher (out of scope).
- **Fix B**: Accept as-is; document the 500-student ceiling.
  - Strength: Keeps the loader a faithful mirror of the teacher precedent; one IB plan across two DP cohorts is realistically under 500 students.
  - Tradeoff: A future large deployment silently 404s valid members; the ceiling is written down nowhere.
  - Confidence: MED — hinges on max plan size, which isn't pinned in any product constraint.
  - Blind spot: No documented upper bound on students-per-plan exists.
- **Decision**: FIXED via Fix A — scoped `fetchPlanStudent` `.maybeSingle()` query added; switcher-list fetch folded into the cohort `Promise.all` batch. Verified: `pnpm check` clean + student integration test passing.

### F2 — Undocumented merge-child post-filter in the student page

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/_pages/student-plan-view/ui/StudentPlanPage.tsx:41
- **Detail**: `buildPerspectiveCourseItems(...).filter(item => mineIds.has(item.courseId))` is a post-filter not in the plan's Phase-3 page contract. It is a deliberate, correct fix — a merge parent resolves to ALL its children, but a student attends only the child they chose, so sibling children must be dropped from the card list (the grid still shows the merged session via the parent's placement). Verified sound by both review passes; covered by the integration test's merge case. The code is fine; the plan simply didn't mention this derivation step.
- **Fix**: Add a one-line addendum to the plan's Phase-3 page contract noting the direct-membership post-filter and its rationale. No code change.
- **Decision**: FIXED — plan.md Phase-3 page-island contract now documents the `.filter(mineIds.has(...))` step and the merge-parent rationale.

### F3 — CourseInfo not re-exported from the student api barrel

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/student-plan-view/api/index.ts
- **Detail**: The teacher api barrel re-exports `type { CourseInfo }` from its loader; the student barrel omitted it. Harmless — `CourseInfo` reaches the page inside `StudentPlanViewData` and the widget owns the type — but the two sibling slices diverged. Cosmetic consistency only.
- **Fix**: Re-export `type { CourseInfo }` from the student api barrel to match the teacher slice.
- **Decision**: FIXED — loader re-exports `CourseInfo` (mirroring the teacher loader's comment + `export type`), and the api barrel now surfaces it. Verified: `pnpm check` / lint / steiger clean.
