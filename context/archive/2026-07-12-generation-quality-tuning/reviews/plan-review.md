<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Generation Quality Tuning

- **Plan**: context/changes/generation-quality-tuning/plan.md
- **Mode**: Deep
- **Date**: 2026-07-13
- **Verdict**: REVISE → **SOUND** (all findings fixed in triage same-day)
- **Findings**: 1 critical, 4 warnings, 2 observations — all triaged FIXED

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (F3 — fixed) |
| Blind Spots | WARNING (F5, F6 — fixed) |
| Plan Completeness | FAIL (F1 critical + F2, F4, F7 — all mechanical, all fixed) |

## Grounding

16/17 paths ✓ (`assemble-snapshot.ts` was cited as entities-layer but lives in
`src/_pages/plan-detail/model/generation/` — became F3), 12/12 symbols ✓, both RPCs
(`clone_plan`, `apply_generated_placements`) exist with matching signatures ✓, brief↔plan ✓
(brief shared F7's stale phase reference).

Deep verification **confirmed** (no findings): `compareObjectives` is length-generic; the only
positional tuple reader is `isConverged` on indices 0–1 (unaffected by tier insertion); soft
availability rides the snapshot unfiltered (`types.ts:30`, `problem.ts:51-52` filters only
greedy-side); the board is one merged two-cohort structure with pins in every index; the
Chemistry fix contract is accurate including `no-students` keyed off folded rosters;
`deriveGoldenSets(courses: GroupingCourse[])` matches the snapshot's actual course type.

## Findings

### F1 — Progress section: Phase 3 merges two success bullets into one checkbox

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: ## Progress → Phase 3 Manual
- **Detail**: Phase 3's Manual Verification had 4 bullets but Progress had 3 checkboxes — 3.5 merged "unplaced residue recorded" + "manual-edit warning confirmed". The Progress↔Phase contract requires one checkbox per success bullet.
- **Fix**: Split into 3.5 (residue) and 3.6 (warn-not-block).
- **Decision**: FIXED

### F2 — No `pnpm check` type gate in Phases 1–6 (lessons.md violation)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Success Criteria, Phases 1–6 + Progress items
- **Detail**: All phases cited test/lint/steiger/build but never `pnpm check`; lessons.md explicitly forbids citing build/lint as a type gate. The `Objective` labeled tuple type mutates in Phases 4–6 — type errors would have surfaced only at Phase 7's /verify.
- **Fix**: `pnpm check` added to every gate line (12 body/progress occurrences + Phase 7's /verify line).
- **Decision**: FIXED

### F3 — Harness snapshot assembly underspecified; assemble-snapshot lives in _pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 harness contract; Current State Analysis
- **Detail**: `assemble-snapshot.ts` is at `src/_pages/plan-detail/model/generation/` with page-layer input shapes (`SharedBoardProps`, `LocalParkedBundle`); no bench file imports from `_pages/**`, and neither existing snapshot builder covers pins (`generation.bench.ts` and `load-plan-analysis-input.ts` both use `pins: []`). The pins path was left for the implementer to invent — exactly where "indistinguishable from in-app" could silently break.
- **Fix A**: Bench-native assembly per `load-plan-analysis-input.ts` pattern + `toPin` equivalence test.
- **Fix B ⭐ chosen**: Relocate `assemble-snapshot` to `src/entities/timetable/model/generation/` with an entity-level input contract; `plan-detail` adapts at the call site; harness shares the exact assembly. Added as Phase 1 change #1.
- **Decision**: FIXED via Fix B

### F4 — Phase 1 criterion 1.1 unrunnable: `pnpm test` never sees bench tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria (1.1)
- **Detail**: The unit project includes only `src/**/*.test.ts`; a `bench/*.test.ts` would run under no config — 1.1 would pass vacuously.
- **Fix**: Phase 1 contract now specifies `bench/**/*.test.ts` joins the unit project include, with containment rules (user-requested): the suffix convention keeps `*.bench.ts`/`*.analyze.ts`/`*.experiment.ts` invisible to the glob; bench `.test.ts` must stay pure (unit project has no `load-test-env`, so DB-reaching tests fail loudly in CI).
- **Decision**: FIXED

### F5 — New violation kinds default to "block" if a registration point is missed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 3 — constraint contracts
- **Detail**: Five registration points; two fail silently: `violationSeverity` (collisions.ts:133-138) defaults unlisted kinds to `block` (contradicting warn-only scope), and verify.ts's else-branch (:91-92) treats unlisted kinds as blocking board-wide including pin-only violations (the livelock case). Only `CollisionDetailsDialog` is compile-gated.
- **Fix**: Registration-surface paragraph added to Phase 3 naming all five points and both traps.
- **Decision**: FIXED

### F6 — fitsAt/verify mismatch failure mode misstated

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (first bullet)
- **Detail**: "Every attempt fails" is wrong — constructed boards are returned unverified (`search.ts:230`; verify gates only LNS acceptance at `:229`). The real failure mode is a burned 20 s budget + failed final verdict, with no in-loop signal. Guidance direction (fitsAt stricter, never looser) was already correct.
- **Fix**: Text corrected; Testing Strategy now requires engine-fuzz to assert `verifyGeneration(...).ok` on constructed boards.
- **Decision**: FIXED

### F7 — Stale phase numbering from the harness insertion

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach; Migration Notes; plan-brief.md
- **Detail**: "Six phases" (should be seven); Migration Notes + brief said the gold attribution shift lands "after Phase 1" — the Chemistry fix is Phase 2.
- **Fix**: All three corrected.
- **Decision**: FIXED
