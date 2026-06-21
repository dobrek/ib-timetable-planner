<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Co-teaching Teacher Sets

- **Plan**: context/changes/co-teaching-teacher-sets/plan.md
- **Scope**: All 7 phases (full plan)
- **Date**: 2026-06-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Local re-verification: unit 427/427 ✓, lint ✓, steiger ✓ (no problems), build ✓.
Not re-run locally (CI-gated, green at their commit shas): `pnpm test:integration`, `pnpm test:e2e`.

## Findings

### F1 — Missing FK index on course_teachers (plan_id, teacher_id)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (Performance edge)
- **Location**: supabase/migrations/20260620120000_course_teachers.sql:29-30
- **Detail**: The table indexes `(plan_id)` and `(plan_id, course_id)` but not `(plan_id, teacher_id)`, leaving `course_teachers_teacher_fkey` uncovered. The cited template `teacher_availability.sql:30` indexes its `(plan_id, teacher_id)` FK pair, and `add_fk_indexes.sql` (20260602210903) states FK columns must be indexed (Supabase `unindexed_foreign_keys` advisor flags them; CASCADE traversals seq-scan). The teacher `ON DELETE CASCADE` and the delete-guard's reverse lookup (`delete-teacher.ts:13` — `.eq(plan_id).eq(teacher_id)`) both hit this exact pair. Negligible at seed scale (~85 rows/plan), latent otherwise. Root cause: the plan's Phase-1 contract itself under-specified the index set (named only the two indexes), so the code faithfully matched the plan.
- **Fix**: New additive migration `20260621120002_index_course_teachers_teacher_fkey.sql` adding `create index course_teachers_plan_teacher_idx on course_teachers (plan_id, teacher_id);` (mirrors `teacher_availability_plan_teacher_idx`).
- **Decision**: FIXED — migration created; `supabase db reset` applied it cleanly and `course_teachers_plan_teacher_idx` verified present in `pg_indexes`. No `database.types.ts` regen needed (indexes are not part of generated types).

### F2 — Unplanned migration clone_plan_drop_teacher_id (justified)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260621120000_clone_plan_drop_teacher_id.sql
- **Detail**: Not named in the plan, but a necessary prerequisite to the Phase-6 column drop: the Phase-1 `clone_plan` body still listed `courses.teacher_id` in its INSERT and remapped it via `_teacher_map`, so dropping the column would have broken the function. This migration re-creates `clone_plan` verbatim minus exactly that column + join, and is correctly ordered (120000) **before** the drop (120001) — no `clone_plan` version ever references a dropped column. Precisely scoped, file-header documented.
- **Fix**: None — correct and self-documented.
- **Decision**: ACKNOWLEDGED — no action.

### F3 — Plan criterion 5.1 says "byte-identical"; seed is structurally identical

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Phase 5 §5.1 + Critical Implementation Details
- **Detail**: `gen-seed.mjs` uses unseeded `node:crypto` `randomUUID()`, so two runs differ on every UUID (confirmed: 3339 differing lines → 0 after UUID-masking). The real, achieved invariant is structural identity, which the guard test `seed-transcode-identity.test.ts` implements and documents honestly in-comment ("a literal diff can never be empty … we mask UUIDs"). The implementation is correct; only the plan's success-criterion prose overstated it as "byte-identical".
- **Fix**: Reword §5.1 and the "Deterministic seed" Critical Implementation Detail from "byte-identical" to "structurally identical (UUIDs masked)".
- **Decision**: FIXED — plan.md reworded in three spots (Critical Implementation Details, Phase 5 §3 contract, §5.1 automated criterion).

## Note — Manual success criteria

Most Manual checkboxes in Progress remain unchecked (2.5–2.6, 3.4–3.6, 4.4–4.6, 5.4, 6.5); only 7.3 is checked. They are honestly left pending (not falsely stamped) and are largely backed by automated coverage: the Phase-7 E2E spec exercises the authoring round-trip + chip persistence + sole-teacher delete-guard at the UI, and integration tests cover junction load, clone-remap, and merge-parent persistence. A manual board pass for double-booking + availability fan-out (2.5/2.6) is worthwhile before final sign-off, but nothing blocks approval.
