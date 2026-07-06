<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Teacher Plan View

- **Plan**: context/changes/teacher-plan-view/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-07-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations
- **Triage**: completed 2026-07-06 — 5 fixed (F1, F2, F4, F5, F6, F7), 1 accepted (F3). Post-fix gate green: check, lint, steiger, test (956), integration (72), build.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria re-verified live on 2026-07-06: `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test` (951 passed), `pnpm test:integration` (72 passed), `pnpm build`, new e2e spec 2/2 passed (full suite green at 9f69300). Phase 1 "zero behavior change" verified at diff level — all sub-100% rename similarities (collisions.ts R085, intersects.ts R088, duplicate-course.ts R091, builders.ts R094) are fully accounted for by import retargets.

## Findings

### F1 — Missing row limits on new shared fetchers (silent 1000-row truncation)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/shared/api/load-teacher-availability.ts (also load-placements.ts, load-course-merges.ts, loader.ts fetchCourseInfo)
- **Detail**: The promoted fetchers issue selects with no explicit `.limit()`, so PostgREST silently caps results at `max_rows = 1000` (supabase/config.toml:18). The teachers-catalog loader sets `.limit(5000)` on the same `teacher_availability` table because 50 teachers × 20+ blocked cells clears 1000. Inherited from the board's inline queries, but the promotion to shared/api was the moment to fix it — truncation silently drops availability shading/violations on the teacher view.
- **Fix**: Add explicit `.limit()` values matching the teachers-catalog loader convention (e.g. 5000 on teacher_availability).
- **Decision**: FIXED — .limit(5000) on teacher_availability; .limit(2000) on placements, course_merges, and fetchCourseInfo. Note: load-cohort-courses.ts has the same pre-existing gap (esp. student_choices), out of scope here.

### F2 — Course-list island hard-crashes on a `courseInfo` miss

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/teacher-plan-view/ui/TeacherCourseList.tsx:56
- **Detail**: `formatCourseBadgeLabel(courseInfo[item.courseId])` throws if the entry is absent. Catalog and `fetchCourseInfo` queries run in parallel without snapshot isolation — a course inserted mid-flight can appear in one and not the other, white-screening a read-only page.
- **Fix**: One-line fallback (`?? { name: item.courseId, … }`) so the page degrades instead of crashing.
- **Decision**: FIXED — titleOf falls back inline (`courseInfo[id] ?? { name: id, level: "none", groupIndex: 0 }`); the intermediate-const form tripped `no-unnecessary-condition` (element access is exempt, a narrowed const is not).

### F3 — Benign unplanned ride-alongs

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; nothing needs to change
- **Dimension**: Scope Discipline
- **Location**: e2e/support/board.ts; src/shared/api/load-student-names.ts; loader.ts:158–175
- **Detail**: (a) `removeBundle` gained a `toPass` retry — flake fix for other specs, unrelated to this feature; (b) `load-student-names.ts` is an unlisted fifth shared fetcher, verified line-for-line extraction from load.ts; (c) the loader's plan-wide `courses` query (`courseInfo`) is an unlisted read serving the planned "merge children still render" requirement.
- **Fix**: Accept — no code change warranted; recorded so the extra diff entries are explained.
- **Decision**: ACCEPTED — extras verified benign and documented here.

### F4 — Third copy of the UUID guard

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/teacher-plan-view/api/loader.ts:20
- **Detail**: `UUID_RE` duplicated a third time (also plan-detail load.ts, load-plan-summary.ts) while `isPlanId` already lives in shared/api. Copies can drift independently.
- **Fix**: Consolidate into one shared UUID guard (e.g. `isUuid` in shared/api beside `isPlanId`) and retarget the three copies.
- **Decision**: FIXED — `isUuid` exported from load-plan-summary.ts (isPlanId aliases it); teacher-plan-view loader.ts and plan-detail load.ts retargeted, local UUID_RE copies deleted.

### F5 — Unreachable `unavailable` / 503 branch in the route

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/plans/[id]/teachers/[teacherId].astro:20,28
- **Detail**: The loader only returns `{kind:"unavailable"}` for a null Supabase client, and the route only calls it when the client is non-null — the 503 arm can never fire. Harmless defensive code copied from the template, but reads as a live path.
- **Fix**: Remove the dead branch or add a comment stating it's defensive-only.
- **Decision**: FIXED — defensive-only comment added; branch kept for template symmetry with sibling routes.

### F6 — `ReturnType<typeof buildAvailabilityIndex>` instead of the exported type

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:143
- **Detail**: The entity barrel already exports `AvailabilityIndex`; the indirect `ReturnType` form is harder to read and bypasses the public API.
- **Fix**: Import and use `AvailabilityIndex` from `@/entities/timetable`.
- **Decision**: FIXED — type imported from the entity barrel; ReturnType form removed.

### F7 — `course-list.ts` has no dedicated unit test

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Testing)
- **Location**: src/_pages/teacher-plan-view/model/course-list.ts
- **Detail**: Pure model logic (composite→children resolution, occurrence sorting, roster extraction) covered only indirectly via the integration test. Comparable pure model files carry co-located `*.test.ts`, and the plan's TDD emphasis applied to exactly this kind of code.
- **Fix**: Add a co-located `course-list.test.ts` covering composite resolution, occurrence ordering, and empty-roster children.
- **Decision**: FIXED — course-list.test.ts added: teacher filtering + occurrence sorting, co-teacher exclusion, merge resolution (in-catalog and catalog-absent children, hours fallback), partial-merge union, foreign-parent merges ignored.
