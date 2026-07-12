<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation Engine Refactor

- **Plan**: context/changes/generation-engine-refactor/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence re-run this session

- `pnpm check` — 0 errors, 0 warnings, 0 hints (625 files)
- `pnpm lint` — clean
- `pnpm steiger` — no problems (FSD gate)
- Generation suite (`vitest run src/entities/timetable/model/generation src/_pages/plan-detail/model/generation`) — 88 tests / 13 files pass, 6.17s wall (≤ 8s criterion)
- `pnpm test` — 1239 tests / 142 files pass
- Two independent sub-agents: no plan drift (all phases MATCH), no CRITICAL/WARNING code defects. The one genuine behavior change (the `verifyGeneration` validity gate in search.ts) traced and confirmed sound; the two documented Phase 3 deviations (Board as `type`; descended-acceptance gate) verified as recorded in change.md. Worker precondition error string byte-identical to pre-refactor.

## Findings

### F1 — Engine's "valid constructed floor" is undocumented for direct callers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/entities/timetable/model/generation/engines/greedy/search.ts (createGreedyEngine docstring)
- **Detail**: The validity-gate fallback's correctness rests on "the constructed board is always valid," which holds only when the caller enforced the pins-only precondition. That precondition lives only in `runVerifiedGeneration` (run.ts:25); the engine does not re-check it. A direct `engine(snapshot, config)` call on a dirty-pins snapshot could return an invalid board. All current direct callers (bench, tests) use pin-free snapshots, so it is a latent trap, not a live bug — but it is the "future runner forgets the precondition" fragility Phase 4 aimed to kill, only half-closed.
- **Fix**: Add the precondition invariant to the createGreedyEngine / driver docstring; point runners at runVerifiedGeneration.
- **Decision**: FIXED — added a "Precondition:" paragraph to the createGreedyEngine docstring (search.ts) stating the engine assumes a pins-only, conflict-free snapshot and that a raw call on a dirty snapshot can return an invalid board.

### F2 — Two engine files marginally exceed the ~300-line target

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: engines/greedy/search.ts (312), engines/greedy/stages.ts (313)
- **Detail**: Criterion 3.3 ("no file exceeds ~300 lines") is marked complete; both files sit at 312/313, inside the plan's explicit "~300" tolerance. They are the decomposition's largest files and each groups several cohesive concepts. Not a criteria failure; a watch item only.
- **Fix**: None required — within tolerance. Watch for growth on the next edit.
- **Decision**: SKIPPED — within tolerance.

### F3 — Stale "a local mulberry32" comment after Phase 2 moved it

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/entities/timetable/model/generation/engine-fuzz.test.ts:16
- **Detail**: Phase 2 made the fuzz test import the shared `mulberry32` (line 6), but the doc comment still says "a local `mulberry32`." The word "local" is now inaccurate — the "doc cites a mechanism the refactor changed" staleness pattern in lessons.md.
- **Fix**: Change "a local `mulberry32`" → "the shared `mulberry32`".
- **Decision**: FIXED — comment updated to "the shared `mulberry32`".
