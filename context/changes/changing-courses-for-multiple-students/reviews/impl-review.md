<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bulk Course-Choice Editing for Multiple Students

- **Plan**: context/changes/changing-courses-for-multiple-students/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-07-12
- **Verdict**: APPROVED
- **Findings**: 0 critical  1 warning  1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Gates re-verified this review

- `pnpm check` ✅ 0 errors / 0 warnings
- `pnpm lint` ✅ · `pnpm steiger` ✅
- `pnpm test` ✅ 1260 passed
- `pnpm test:integration` ✅ 102 passed (incl. new bulk-edit suite)
- `pnpm build` ✅
- `pnpm exec playwright test bulk-edit-choices` ✅ 3 passed (happy-path + WYSIWYG + setup) — closed F2

## Summary

Faithful implementation: all 17 planned changes MATCH intent, no scope creep, no missing
items. Security design verified real (validation-free `security invoker` RPC backstopped by
composite FKs + TS cohort gates, integration-proven); destructive DELETE correctly
triple-scoped (`plan_id` + `student_id IN` + `course_id IN`); every new file tracks its
sibling conventions (semantic tokens, RHF/`submitForm` idiom, `DomainError` shape, FSD import
direction). The phantom-submit fix (7c4e033) is correct and E2E-guarded. Both findings concern
known, deliberately-deferred edges rather than defects in what shipped.

## Findings

### F1 — Students page hard-throws once a plan reaches 1000 choices

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/students/api/loader.ts:23,28,75-81
- **Detail**: Phase 2 lowered `CHOICES_LIMIT` 2000→1000 to align with PostgREST `max_rows` so
  truncation fails loudly (a genuine improvement — the old ≥2000 guard was unreachable, so past
  1000 choices the read silently dropped rows and a single-student edit could then silently
  delete unseen choices). Residual: the choices read is plan-wide (`.eq("plan_id", planId)`,
  both cohorts), so at ≥1000 total `student_choices` `assertChoicesNotTruncated` throws and the
  entire students page — the surface hosting this feature — refuses to render. A full two-cohort
  plan (~300 students × ~6 ≈ 1800 rows) can't open the page at all; one bulk-add allows 500×64
  new rows per call. Plan explicitly deferred pagination / cap-raise (and the identically-capped,
  still-unguarded `load-cohort-courses.ts` read) to a follow-up. No production data exists yet.
- **Fix A ⭐ Recommended**: Accept as-is; keep the pagination / cap-raise follow-up tracked.
  - Strength: Honors the plan's deliberate loud-over-silent decision; no scope expansion on a
    shipped, fully-green change; strictly safer than the prior silent truncation.
  - Tradeoff: A large existing plan would hard-error on the students page until the follow-up lands.
  - Confidence: HIGH — plan "What We're NOT Doing" #6 + loader comment name this exact follow-up; no prod data.
  - Blind spot: `load-cohort-courses.ts` (same ceiling, no guard) may silently truncate a board today — not re-verified.
- **Fix B**: Pull a minimal pagination mitigation into this change so the page survives past 1000.
  - Strength: Removes the hard-block where the feature makes it likelier to be hit.
  - Tradeoff: Expands a closed, green change; per-cohort scoping isn't clean (island renders both cohort tabs from one load) → real pagination work.
  - Confidence: MED — pagination well-understood but non-trivial; touches the load contract the island depends on.
  - Blind spot: Downstream consumers assuming the single-read shape.
- **Decision**: ACCEPTED (Fix A) — ship as-is; pagination/cap-raise + unguarded `load-cohort-courses.ts` follow-up queued in `follow-ups/review-fixes.md`.

### F2 — e2e green evidence predates the phantom-submit fix; not re-run

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 3.4 · e2e/specs/bulk-edit-choices.spec.ts:55-59
- **Detail**: The e2e checkbox (3.4) is stamped f579a9e, but the dialog + spec changed in two
  later fix commits (7c4e033, 67d805e) that added the phantom-submit regression guard now in the
  spec. So the cited "e2e green" predated that guard, and e2e was not re-run at review time. The
  code fix is correct by inspection ("Review…" is `type="button"` onClick=goToConfirm; only
  "Apply" is `type="submit"`; distinct per-step button keys).
- **Fix**: Re-run `pnpm test:e2e` to confirm the post-fix spec is green end-to-end.
- **Decision**: FIXED — re-ran `pnpm exec playwright test bulk-edit-choices` this review: 3 passed (happy-path + WYSIWYG + setup). Post-fix spec green incl. the phantom-submit regression guard.
