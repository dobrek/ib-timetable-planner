<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Course Merge Builder

- **Plan**: `context/changes/course-merge-builder/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-08
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 2 observations — all fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (F1, F3) → resolved |
| Plan Completeness | WARNING (F2, F4) → resolved |

## Grounding

11/11 existing paths ✓ (`merge.ts` net-new, expected MISS), 4/4 symbols ✓ (`createOverlap`, `requireSession`, `requireSupabase`, `23505`), brief↔plan ✓, Progress↔Phase mechanical contract ✓.

Verified against code: the "no algorithm change" claim holds — a 0-choice parent is excluded from `regularCourses` (`directStudents.has` gate) and added once as a `virtualCourse` from `childrenOf` (`src/lib/grouping/adapters/supabase.ts:41-58`); zero-hours warning suppression for merge children is already in place (`:168`). Cascade-on-dissolve (`course_merges` FKs `on delete cascade`), the `unique(parent_course_id, child_course_id)`-only constraint, the `navigate(pathname+search)` filter reset that Phase 5 fixes, and the `createOverlap` same-cohort precedent all confirmed.

## Findings

### F1 — dissolveMerge / updateMergeHours don't verify the target is a merge parent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Merge actions (plan.md `dissolveMerge` / `updateMergeHours` contracts)
- **Detail**: `dissolveMerge` deletes the parent `courses` row by id with no check that the id is actually a merge parent — invoked on a plain atomic course it silently deletes a regular course, contradicting its "children kept, parent removed" contract. `updateMergeHours` likewise edits any course's hours with no parent-type guard. The server action is the authoritative gate everywhere else in this file (cf. `createOverlap`'s same-cohort re-check).
- **Fix**: Add a parent-type guard to both — `select parent_course_id from course_merges where parent_course_id = eq(id) limit 1`; throw `NOT_FOUND` if absent. Mirrors `createOverlap`'s load-then-validate pattern.
- **Decision**: FIXED (Fix in plan — guard added to both action contracts in Phase 2)

### F2 — Parent cohort_id sourced from client input, not derived from children

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 `mergeInput` + Phase 2 `createMerge`
- **Detail**: `mergeInput` carries a client `cohortId` and `createMerge` inserts "cohort_id" without specifying the source — most naturally `input.cohortId`. But `deriveMergeParent` already returns a `cohortId` computed from and validated across the children. A disagreement lands the parent in the wrong cohort, and grouping then fetches children's choices by the wrong cohort's courseIds (`src/lib/grouping/adapters/supabase.ts:25-31,56`), silently producing a zero-student virtual course. The input cohortId is redundant and a spoofing surface.
- **Fix**: Insert the parent with `derivation.cohortId`; demote `input.cohortId` to an assert-only check (`input.cohortId === derivation.cohortId`, else `BAD_REQUEST`).
- **Decision**: FIXED (Fix in plan — chose "derive + assert match"; edited `mergeInput` and `createMerge` contracts)

### F3 — "Simulated link failure leaves no orphan parent" (2.5) has no feasible trigger

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Manual Verification 2.5
- **Detail**: The compensating-cleanup snippet is the plan's headline safety mechanism, but the natural DB-level link-failure triggers are unreachable — the load-children gate intercepts missing/FK-violating children, and the derivation gate intercepts duplicate children before any insert. As written the orphan-guard is effectively unverifiable, so the criterion would likely be waved through.
- **Fix**: Extract the two-step write as a `writeMergeAtomic({ insertParent, insertLinks, deleteParent })` seam; a unit test stubs `insertLinks` to throw and asserts `deleteParent` fires. Makes 2.5 a CI-gated unit test.
- **Decision**: FIXED (Fix in plan — chose "make it testable"; added the seam to Critical Implementation Details and rewrote criterion 2.5 + Progress 2.5)

### F4 — "Shared base name" rule phrased ambiguously

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 `deriveMergeParent` contract
- **Detail**: "mismatched base name" implies the derivation might strip a level/suffix from `course.name`. But `course.name` is already the bare subject ("German B") with level in a separate column (`src/components/courses/types.ts:12-23`), so the rule is exact `name` equality — no parsing. Ambiguous wording invites a needless suffix-stripper.
- **Fix**: State the rule is exact equality of `course.name` across children (no parsing); the parent's name is that shared name verbatim.
- **Decision**: FIXED (Fix in plan — clarified the name rule in `deriveMergeParent`'s contract)

## Triage Summary

- **Fixed**: F1, F2, F3, F4 (4)
- **Skipped / Accepted / Dismissed**: none
- **Verdict after fixes**: REVISE → SOUND
