<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Course Merge Builder

- **Plan**: context/changes/course-merge-builder/plan.md
- **Scope**: All 5 phases (full plan)
- **Date**: 2026-06-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks all green: `pnpm test` (113 passed), `pnpm exec astro sync`, `pnpm lint`, `pnpm build`.

All 10 planned changes verified MATCH — no drift, no missing work. The `src/lib/courses/*.ts` action-split refactor (including pre-existing course/overlap actions) is behavior-preserving and aligns with the recorded "thin Actions + per-action domain files" preference; it is what makes the merge actions Vitest-testable. Both required testable seams (`writeMergeAtomic` compensating-delete, `assertMergeParent` guard) exist and are CI-gated.

## Findings

### F1 — Compensating DELETE discards its own error (silent orphan window)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/courses/createMerge.ts:70-72
- **Detail**: The compensating cleanup is wired and CI-tested, but `deleteParent` discarded the error from its own DELETE. If that DELETE fails (transient DB error), the orphan parent lingered silently with no log. Accepted double-fault residual of the no-transaction design — but previously unobservable.
- **Fix**: Capture the delete error in `deleteParent` and `console.error` it (matching the `src/middleware.ts` eslint-disable + console.error pattern); user-facing throw unchanged.
- **Decision**: FIXED

### F2 — "Delete merge" wording diverges from plan's "Dissolve" verb

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/courses/MergeManageDialog.tsx
- **Detail**: The plan uses "Dissolve merge" (action is `dissolveMerge`); the manage dialog's UI button/label and success toast say "Delete merge" / "Merge deleted". Cosmetic only — action and described consequence are correct.
- **Fix**: Rename the dialog's button/label/toast to "Dissolve" to match the plan and action name.
- **Decision**: SKIPPED
