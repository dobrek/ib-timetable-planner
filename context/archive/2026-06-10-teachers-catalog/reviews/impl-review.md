<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Teachers Catalog

- **Plan**: context/changes/teachers-catalog/plan.md
- **Scope**: All 3 phases (Model + Schemas, API Layer, UI + Page Wiring)
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Missing empty-cohort guard on teachers page

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/teachers.astro:14
- **Detail**: `loadTeacherCatalog` maps Y1/Y2 from the first two cohort rows by sorted name. When the cohorts table is empty, `y1`/`y2` become `""`, so assignment badges and hour totals never match real cohort IDs. `courses.astro` guards this with a "No cohorts yet" message; `teachers.astro` does not.
- **Fix**: Mirror `courses.astro` — if `catalog.cohortIds.y1` is empty, render a muted empty-state message instead of `<TeacherCatalog>`.
  - Strength: Matches established courses page pattern; prevents confusing empty badge/hour columns.
  - Tradeoff: Minor — one conditional branch in the Astro page.
  - Confidence: HIGH — identical guard already exists in `courses.astro:17-18`.
  -   Blind spot: None significant.
- **Decision**: FIXED

### F2 — Submit button not disabled during async mutation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/teachers/ui/TeacherFormDialog.tsx:88
- **Detail**: The submit button has no `disabled={form.formState.isSubmitting}` guard. A fast double-click can fire duplicate create/update calls. `CourseFormDialog.tsx:219` disables submit while submitting.
- **Fix**: Add `disabled={form.formState.isSubmitting}` to the submit button.
- **Decision**: FIXED

### F3 — Dialog props use onClose instead of onOpenChange

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/teachers/ui/TeacherFormDialog.tsx:30, DeleteTeacherDialog.tsx:20
- **Detail**: Plan and courses slice use `onOpenChange: (open: boolean) => void`. Teachers dialogs use `onClose: () => void`. Behavior is correct; naming diverges from the reference slice.
- **Fix**: Rename `onClose` → `onOpenChange` and align call sites with courses pattern.
- **Decision**: SKIPPED

### F4 — Integration tests not in repo

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: N/A
- **Detail**: Plan Testing Strategy lists teacher CRUD integration tests (create→read→update→delete, SET NULL cascade). No dedicated integration test file exists; Phase 2.3 marked complete via manual verification only.
- **Fix**: Add integration tests under the existing integration test harness when Supabase stack is available.
  - Strength: Closes coverage gap documented in plan.
  - Tradeoff: Requires local Supabase; deferred to Module 3 test strategy per project notes.
  - Confidence: MEDIUM — manual sign-off recorded in Progress.
  -   Blind spot: Integration harness conventions not verified in this review.
- **Decision**: ACCEPTED-AS-RULE: Catalog CRUD integration tests belong in the test harness

### F5 — Loader silently truncates at 500 rows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/teachers/api/loader.ts:19,25
- **Detail**: Teachers and assigned courses both capped with `.limit(500)`. Beyond that scale, badges and delete-impact counts would be incomplete with no warning. Same pattern as `courses/api/loader.ts`.
- **Fix**: No change needed at current scale (~18 teachers). Revisit if catalog grows.
- **Decision**: SKIPPED

### F6 — Update of missing teacher surfaces generic server error

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/teachers/api/update-teacher.ts:16
- **Detail**: Updating a non-existent UUID makes PostgREST `.single()` fail (PGRST116), which becomes INTERNAL_SERVER_ERROR instead of NOT_FOUND. Basic CRUD handlers in courses slice share this behavior.
- **Fix**: Optionally map PGRST116 → DomainError("NOT_FOUND", "Teacher not found") for clearer UX.
- **Decision**: FIXED
