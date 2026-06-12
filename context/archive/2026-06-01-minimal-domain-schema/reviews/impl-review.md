<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Minimal Domain Schema

- **Plan**: context/changes/minimal-domain-schema/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 2 observations

Reviewed with the Supabase best-practices lens (`/supabase` skill). DB-level success
criteria verified live against the running local stack: cohorts=2, students=61,
student_choices=513, courses=83, course_overlaps=18, course_merges=11, teachers=18,
phantom-course guard returns 0 rows, RLS enabled on 12/12 public tables,
database.types.ts = 597 lines covering all 12 tables.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Canonical reference fixture mutated; remediation differs from plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline / Plan Adherence
- **Location**: data/dp1/teachers_subjects.csv (commit 3fc9fd4)
- **Detail**: 3 rows added to a canonical reference fixture (`KS,German B,SL,,2`,
  `KS,German B,AB,,2`, `NR,Spanish B,SL,,0`) so dp1 student picks resolve to standalone
  courses. plan.md:356 prescribed back-filling STUDENT rows; impl edited TEACHER-side
  course definitions. Recorded only in the commit message, not the plan body.
- **Fix**: Add a plan.md addendum documenting the fixture edit, rationale, and that it
  supersedes the "back-fill student rows" wording.
- **Decision**: FIXED — addendum added to plan.md ("## Addenda (post-implementation)").

### F2 — courses CHECK relaxed (>0 → >=0); plan contract not reconciled

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:172
- **Detail**: Migration ships `check (hours_per_week >= 0)` for 0-hour merge-child courses;
  plan.md:172 contract still read `> 0`.
- **Fix**: Edit plan.md:172 from `>0` to `>=0`.
- **Decision**: FIXED — contract line updated to `>= 0` with a merge-child note;
  rationale captured in the Addenda section.

### F3 — Unindexed foreign keys (7 columns)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (performance)
- **Location**: supabase/migrations/20260602185012_minimal_domain_schema.sql
- **Detail**: Confirmed live — no leading-position index on students.cohort_id,
  plan_variants.plan_id, course_overlaps.dependent_course_id, course_merges.child_course_id,
  placements.course_id, placements.cohort_id, course_groupings.cohort_id. All ON DELETE
  CASCADE; Supabase unindexed_foreign_keys advisor flags them.
- **Fix A (Recommended)**: New follow-up migration adding btree indexes on the 7 columns.
- **Fix B**: Defer to the slice that first queries these paths.
- **Decision**: FIXED via Fix A — added supabase/migrations/20260602210903_add_fk_indexes.sql
  (7 indexes). Applied to live DB; re-check confirms zero remaining unindexed FK columns.

### F4 — Generated seed.sql not excluded from Prettier

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .prettierignore
- **Detail**: supabase/seed.sql (committed 87KB generated artifact) not prettier-ignored,
  unlike the sibling generated file src/lib/database.types.ts.
- **Fix**: Add `supabase/seed.sql` to .prettierignore.
- **Decision**: FIXED — added `supabase/seed.sql` to .prettierignore.

### F5 — Untracked Studio scratch query in the tree

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline (hygiene)
- **Location**: supabase/snippets/Untitled query 348.sql (untracked)
- **Detail**: Studio scratch file in the working tree, not gitignored — next `git add`
  would pick it up.
- **Fix**: Add `snippets/` to supabase/.gitignore and delete the stray file.
- **Decision**: SKIPPED — user will handle.

### F6 — Seed UUID propagation mechanism differs from plan

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: scripts/gen-seed.mjs
- **Detail**: Plan (plan.md:366) specified CTE / INSERT…RETURNING chaining; generator
  pre-generates UUIDs in JS and emits flat INSERT…VALUES. Functionally equivalent.
- **Fix**: None — JS approach is acceptable.
- **Decision**: ACKNOWLEDGED & CLOSED — no action.
