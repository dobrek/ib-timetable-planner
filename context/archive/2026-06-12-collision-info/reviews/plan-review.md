<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Collision Info (Explainable Collision Feedback)

- **Plan**: context/changes/collision-info/plan.md
- **Mode**: Deep
- **Date**: 2026-06-13
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations

> Note: this review ran post-implementation (status was already `implemented`). Grounding and claim verification were done against the plan-authoring commit `b145e38`; the implementation at `HEAD` was consulted during triage to confirm fixes reflect what actually shipped.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

13/13 paths ✓ at plan commit b145e38 (`load-cohort-courses.ts` referenced by basename lives at `src/shared/lib/catalog-hash/`), 3/3 symbols ✓, migration claims ✓ (teacher `full_name` nullable + `code` unique; student `full_name` non-null), brief↔plan ✓, Progress section ✓ mechanically well-formed.

Deep verification confirmed: static title-only badge (SlotCell.tsx:87-97 @ b145e38), remove-button `pointerdown` stopPropagation precedent, `index.astro` → `PlanDetailPage.astro` props spread auto-forwards new loader fields, `CourseOverlaps` and `placementErrorMessage` precedents are accurate, registry pattern duplicates nothing existing, collisions are a `useMemo([placements, catalogById])` derivation as claimed.

## Findings

### F1 — Dialog title labels assumed reusable, but they weren't

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3.3 — CollisionDetailsDialog contract
- **Detail**: The contract reuses "the same day/period labels PlannerGrid renders in its headers", but at plan time `DAY_LABELS` was a non-exported const (PlannerGrid.tsx:15) and period labels were inlined JSX. No phase step covered extraction; the plan-brief flagged it as an unverified assumption but the resolution never became a plan step. The implementer bridged it by creating `lib/slot-labels.ts` (`dayLabel`/`periodLabel`), used by both the grid and the Dialog.
- **Fix**: Add the `slot-labels.ts` extraction to Phase 3.4 (files, intent, contract).
- **Decision**: FIXED — Phase 3.4 now lists `lib/slot-labels.ts` with the `dayLabel`/`periodLabel` contract, matching the shipped implementation.

### F2 — `cellKey` co-export missing from the blast radius

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1.5 — Verbose per-cell derivation
- **Detail**: The plan inventories `deriveCollisions`' consumers (tests + PlannerBoard — verified correct), but `collisions.ts` also exports `cellKey`, imported by `PlannerGrid.tsx:3` and `SlotCell.tsx:5`. Risk bounded — dropping it is a compile error.
- **Fix**: One line in the Phase 1.5 contract preserving the `cellKey` export.
- **Decision**: FIXED — contract line added naming the outside importers.

### F3 — Two constraint edge-semantics left implicit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1.2 — constraint evaluator contracts
- **Detail**: (a) Raw `hasIntersection` flags a duplicate when `course.id` merely appears in the list — including itself (`collision.test.ts:15` asserts `hasIntersection(c, [c]) === true`); the duplicate-course `test` must keep "id present among others" semantics, not "appears more than once". (b) Teacher matching is strict `!== null` equality — an empty-string `teacherKey` is a valid colliding key, and truthiness-based grouping would diverge undetected by the existing `t1`/null fixtures.
- **Fix**: Pin both semantics in the Phase 1.2 contracts; optionally add a `""` teacherKey fixture.
- **Decision**: FIXED — both semantics pinned in Phase 1.2. Verified the shipped code already honors them (`duplicate-course.ts` test uses `others.some(id ===)`; `teacher-conflict.ts` uses strict `!== null`). **Residual**: the optional `""` teacherKey fixture is not present in `constraints.test.ts` — candidate for a follow-up or the next impl-review.

## Triage Summary

- Fixed: F1, F2, F3 (3)
- Skipped: — (0)
- Accepted: — (0)
- Dismissed: — (0)
- Verdict after fixes: SOUND
