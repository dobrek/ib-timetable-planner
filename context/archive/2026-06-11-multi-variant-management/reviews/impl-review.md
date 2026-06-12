<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Multi-Variant Management (Plans as Cloneable Domain Root)

- **Plan**: context/changes/multi-variant-management/plan.md
- **Scope**: Full plan — Phases 1–5
- **Date**: 2026-06-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification summary

All automated success criteria re-verified green on 2026-06-12: `pnpm lint`, `pnpm steiger`, `pnpm test` (235/235), `pnpm test:integration` (11/11, zero skipped), `pnpm build`, Phase 1 grep checks, CI `success` on the change's commits (e754366..5fcacc2). Hosted `db diff`/`db advisors` (5.1/5.4) not re-run remotely; stand as verified at implementation.

Drift: zero MISSING items, zero scope creep — all "What We're NOT Doing" guardrails clean. Unplanned files are necessary glue (`src/shared/api/load-plan-summary.ts`, `src/app/layouts/PlanScopedError.astro`, `forms.ts` refresh override for clone/create navigation) or a zero-behavior rename (`cn.ts` → `cn/`). Two benign documented drifts: redirect mechanism (F2) and the students integration suite targeting "Seed Plan B" for test isolation.

## Findings

### F1 — courses.teacher_id escapes the composite-FK net; clone silently NULLs cross-plan teacher links

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260611180006_plans_as_domain_root.sql:31-43; supabase/migrations/20260611180100_clone_plan_fn.sql:71-77
- **Detail**: The plan's invariant — "composite FKs make cross-plan references impossible at the DB level" — has one exception: `courses.teacher_id` kept its original plain FK to `teachers(id)` (ON DELETE SET NULL) and was never re-keyed to `(plan_id, teacher_id)`. A crafted createCourse/updateCourse call can attach a teacher from another plan — the row mapper (`src/_pages/courses/api/course-record.ts`) writes `teacher_id` unchecked, with no app-side plan assertion (unlike `assertChoicesInCohort`/`assertMergeParent`). `clone_plan` then silently NULLs such a link via its LEFT JOIN on the teacher map instead of failing loudly. Exploitability is low (blanket-auth single-author tool; UI only offers same-plan teachers), but it's a hole in the change's central integrity guarantee.
- **Fix A ⭐ Recommended**: Additive migration — `UNIQUE (plan_id, id)` on teachers + composite FK `courses (plan_id, teacher_id) → teachers (plan_id, id)`
  - Strength: Closes the gap at the same level as every other link in this change; makes a missed clone remap fail loudly instead of NULLing.
  - Tradeoff: Needs a new migration pushed to hosted; clone_plan LEFT JOIN must keep NULL semantics (it already does).
  - Confidence: HIGH — identical pattern already applied to five sibling tables in 20260611180006.
  - Blind spot: Haven't verified no seeded/hosted row already violates it (local seed is per-plan generated, so it shouldn't).
- **Fix B**: App-side guard only — assert teacher belongs to the plan in create/update-course
  - Strength: No migration, no hosted push; mirrors the existing assertChoicesInCohort guard pattern.
  - Tradeoff: Leaves the DB invariant incomplete; clone still NULLs silently.
  - Confidence: MED — works, but contradicts the change's own stated design rationale.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — migration `supabase/migrations/20260612090000_courses_teacher_composite_fk.sql` (composite FK with `on delete set null (teacher_id)`, plan-scoped index). Verified: local `db reset` clean, integration 11/11. Hosted `db push` still pending.

### F2 — Redirect mechanism differs from plan (documented)

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/courses.astro (also students.astro, teachers.astro)
- **Detail**: Plan said `return Astro.redirect("/plans")`; implementation sets `Astro.response.status = 302` + Location header, with an inline comment citing a type-checked-lint bug on top-level frontmatter returns. Behavior identical (302).
- **Fix**: None needed — accept the documented workaround.
- **Decision**: ACCEPTED — documented workaround stands.

### F3 — Hub loader fans out 1 + 3N count queries

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/_pages/plans-list/api/loader.ts:40-57
- **Detail**: `loadPlans` issues 3 head-count queries per plan, bounded by `.limit(200)` — up to 601 PostgREST calls, not the "tens of plans" the plan's sizing assumed. Fine at current scale (2–3 plans).
- **Fix**: When plan count grows, collapse to 3 grouped aggregate queries (or a view). No action now.
- **Decision**: ACCEPTED — deferred until plan count grows.

### F4 — Hub "Last updated" only reflects renames

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability/UX)
- **Location**: src/_pages/plans-list/api/loader.ts:13; src/_pages/plans-list/ui/PlansHub.tsx:92
- **Detail**: `plans.updated_at` bumps only on plans-row updates (rename) — catalog/board edits inside a plan never touch it, so the hub column understates activity. Known per the loader docstring.
- **Fix**: Later, bump `plans.updated_at` on scenario mutations (or relabel the column). No action now.
- **Decision**: ACCEPTED — known limitation, deferred.

### F5 — clone_plan temp tables not retry-safe within one transaction

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: supabase/migrations/20260611180100_clone_plan_fn.sql:129-134
- **Detail**: Eager `DROP TABLE pg_temp._*` runs only on success; after a savepoint-caught exception, a retry within the same transaction collides on CREATE TEMP TABLE. Test-harness edge only — PostgREST wraps each RPC in its own transaction, where ON COMMIT DROP covers it.
- **Fix**: Optional hardening — `DROP TABLE IF EXISTS` at function start. Safe to skip.
- **Decision**: SKIPPED — test-harness edge only.

### F6 — Nested catalog pages do two sequential DB round-trips

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (performance)
- **Location**: src/pages/plans/[id]/courses.astro:8-12 (also students.astro, teachers.astro)
- **Detail**: `loadPlanSummary` then `loadCatalog` await sequentially; the catalog query only needs `Astro.params.id`, so they could run via `Promise.all` with the 404 decided after. One extra serial round-trip per catalog page view.
- **Fix**: `Promise.all` the two loads if page TTFB matters.
- **Decision**: FIXED — the three nested pages now `Promise.all` the plan summary and catalog loads, guarded by a new exported `isPlanId` (shared/api) so malformed ids stay on the 404 path. Verified: lint, steiger, test 235/235, build all green.
