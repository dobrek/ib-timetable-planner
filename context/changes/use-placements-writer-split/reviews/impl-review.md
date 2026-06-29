<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Split usePlacements into a WriteContext + writer factories

- **Plan**: context/changes/use-placements-writer-split/plan.md
- **Scope**: Phases 0–3 of 4 (all complete)
- **Date**: 2026-06-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Faithful, behavior-preserving extract-to-factory refactor. All 11 moved persister/handler bodies are
logic-identical to `main` under a comment/whitespace-normalized diff (two-store rollback order in
`persistShelve`/`persistPlaceBack`, week-precedence in `persistAddGroup`, partial-failure
`setError(null)`-before-banner ordering, duplicate search). The one non-trivial change the plan
mandated — rewiring `duplicateBundle`'s internal `addGroup(...)` to
`persistAddGroup(…, false, weekByMember, "duplicate")` — is implemented exactly. The recorder-bypass
invariant is structurally intact: `use-reconcile-executor.ts` is byte-identical to `main`, its param
stays the narrow `ReconcileExecutorDeps`, it receives the wider `ctx` via structural subtyping and
never references `recordEdit`. All "What We're NOT Doing" guardrails respected (no executor retype,
`useLatest` stays in the hook, factories unmemoized, no `runOptimistic`). FSD direction clean, no
circular/upward imports.

Automated success criteria re-run this review — all green: `pnpm check` 0 errors · `pnpm test`
832/832 (after fixes) · `pnpm lint` clean · `pnpm steiger` clean · `pnpm build` complete. Manual
criteria all checked in Progress with e2e evidence on the production preview.

## Findings

### F1 — cellScope exported from write-context but only consumed by board-writes

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/placement/write-context.ts:38
- **Detail**: `write-context.ts` exported both the `WriteContext` type and the `cellScope` helper; post-split `cellScope`'s only consumer is `board-writes.ts`. The type ownership is correct; the helper belonged with its consumer so write-context stays a pure shared-contract module.
- **Fix**: Move `cellScope` into `board-writes.ts` (as a module-level helper below the factory); leave `write-context.ts` type-only and drop its now-unused `cellKey` import.
- **Decision**: FIXED — moved `cellScope` into board-writes.ts; removed `cellKey` import from write-context.ts. Verified: check 0 errors, lint clean, 829 tests pass.

### F2 — Partial-failure banner branches lacked unit coverage

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/_pages/plan-detail/model/placement/shelf-writes.ts:145-147 · board-writes.ts:283
- **Detail**: Full-rollback paths were all tested. The secondary partial-success `groupFailureError` banner branch was tested for `addGroup` but not for `placeBack` or `persistMoveMembers`; `addGroup`'s `oppositeWeek` path was also untested. Behavior is verbatim from `main` and e2e-covered — a coverage completeness gap, not a defect.
- **Fix**: Add partial-failure cases for `placeBack` (shelf-writes.test.ts) and `moveBundle`/`persistMoveMembers` (board-writes.test.ts), plus an `oppositeWeek` alternation case for `addGroup`.
- **Decision**: FIXED — added 3 tests (placeBack partial-failure, moveBundle partial-failure, addGroup oppositeWeek a/b alternation). Suite 30 → 33; full suite 832/832.

### F3 — Test scaffolding duplicated across the two new suites

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/model/placement/shelf-writes.test.ts · board-writes.test.ts
- **Detail**: `makeStore` / `flush` / `serverRow` (and the fake-WriteContext harness) are copy-pasted across both new test files. Acceptable co-located scaffolding and consistent with sibling tests, but a shared test util would remove drift risk.
- **Fix**: Extract the shared fake-store/flush/serverRow helpers into one placement test util and import from both suites.
- **Decision**: SKIPPED — co-located scaffolding matches the sibling-test convention; extracting now is speculative.
