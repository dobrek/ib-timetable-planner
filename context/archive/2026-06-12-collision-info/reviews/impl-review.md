<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Collision Info (Explainable Collision Feedback)

- **Plan**: context/changes/collision-info/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Summary

A clean change. Every planned file matches its stated intent and contracts — no
drift, no missing implementation, no scope creep. The two semantic traps the plan
called out are both handled correctly: duplicate-course `test` is "present among
others" (preserving `hasIntersection(c,[c]) === true`), and teacher-conflict uses
strict `!== null` (not truthiness). The performance seam holds — `enumerate.ts`
still calls only the short-circuiting `test`; the enumerating `explain` runs only
in the per-cell `useMemo` over tiny N. `deriveCollisions` is fully removed,
`BoardContext` stays minimal, and the stale-closure footgun is avoided (collisions
remain a pure `useMemo` derivation).

All automated success criteria pass: `pnpm test` (267, incl. the F1 fixture added
during triage), `pnpm lint`, `pnpm steiger`, `pnpm build`, `pnpm test:integration`
(13). All manual criteria checked off in Progress with commit evidence.

A safety-sweep candidate WARNING (`load.ts:109` `fetchStudentNames` lacks the
`?? code` fallback the teacher path has) was investigated and dismissed:
`students.full_name` is `text not null` (`20260602185012_minimal_domain_schema.sql:72`),
so null can never reach the map and the generated type is `string`. Not a finding.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Planned empty-string teacherKey fixture not added

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/_pages/plan-detail/model/constraints/constraints.test.ts
- **Detail**: Phase 1 #2 directed "add a `""` fixture to the constraint tests; the existing t1/null fixtures would not catch truthiness drift." No `teacherKey: ""` fixture existed. Production logic was correct (teacher-conflict matches by strict `!== null`), but the truthiness-vs-null distinction was unguarded by a test. Already acknowledged as a known residual in change.md.
- **Fix**: Add a two-course fixture both carrying `teacherKey: ""` and assert teacher-conflict's `explain`/`test` report a collision, locking the strict-null semantics.
- **Decision**: FIXED — added "treats an empty-string teacherKey as a valid colliding key (strict null, not truthiness)" case to the `teacherConflict` describe block; `pnpm test` → 267 passed.

### F2 — Singular/plural module names invite mis-import

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/collision.ts vs collisions.ts
- **Detail**: The slice carries both `collision.ts` (singular — `hasIntersection`) and `collisions.ts` (plural — `deriveCellViolations`), plus parallel `collision.test.ts` / `collisions.test.ts`. Compiler-unambiguous but an easy mis-import trap. Pre-existing — this change did not introduce the dual naming, only added to the plural side.
- **Fix**: If touched again, consider renaming `collision.ts` → `intersection.ts` to match its single export's intent.
- **Decision**: SKIPPED — pre-existing, out of scope for this change.
