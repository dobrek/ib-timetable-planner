<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cohort Switching (S-04)

- **Plan**: context/changes/cohort-switching/plan.md
- **Mode**: Deep
- **Date**: 2026-06-22
- **Verdict**: REVISE (fixed → SOUND)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

18/18 paths ✓, 4/4 symbols ✓ (BOARD_COHORT `load.ts:15`, `weeksDisjoint` `week.ts:19`, `COHORTS`/`cohortSchema` `cohorts.ts`, 6× `it.todo` `collision-parity.test.ts:241-246`), brief↔plan ✓. Minor: plan cites the six guards at `:240-247`; actual range is `:241-246`.

## Findings

### F1 — "Parity-harness guaranteed" drag agreement is not actually tested

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §11 + Testing Strategy; Desired End State (line 24)
- **Detail**: The plan names week-aware drag mirroring in `classifyCell` as "the one novel piece" / "main correctness risk" and claims committed↔drag agreement is "parity-harness guaranteed." But `assertParity` (`collision-parity.test.ts:48-68`) calls only `deriveCellViolations` (committed path) and never `deriveDropHints`. The "parity" is per-validator-class vs. the oracle on the committed path — not committed-vs-drag. Drag coverage lives in a separate file (`drop-hints.test.ts`) the plan never touches. So as specified, the six guards cover the committed path only; the riskiest novel code ships with no automated test behind a plan that claims it's covered.
- **Fix A ⭐ Recommended**: Extend `assertParity` to also run `deriveDropHints` and assert committed↔drag agreement per case.
  - Strength: One change covers all six guards on both paths; directly closes the divergence class the plan calls its #1 risk; makes "parity" honest.
  - Tradeoff: Committed cases carry a chosen week, drag has none — the helper must map each case to a pre-drop drag scenario; non-trivial edit.
  - Confidence: HIGH — both fns share `bucketByCell`/`violatesAny`; mapping is mechanical once defined.
  - Blind spot: Bundle/grouping drag shapes may need their own rows.
- **Fix B**: Add explicit cross-cohort cases to `drop-hints.test.ts` directly.
  - Strength: Smaller, isolated; matches where drag tests already live.
  - Tradeoff: Two parallel oracles can drift — exactly what a parity harness avoids.
  - Confidence: HIGH — `drop-hints.test.ts` already tests `classifyCell`.
  - Blind spot: Doesn't fix the misleading "parity-harness guaranteed" wording.
- **Decision**: FIXED (Fix A) — Phase 1 §11 now upgrades `assertParity` to run `deriveDropHints` alongside `deriveCellViolations` before adding the six guards; Testing Strategy updated to match.

### F2 — Phase 3 E2E assumes a reachable cross-cohort teacher

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1
- **Detail**: The cross-cohort flag fires only when the same teacher teaches a placeable course in both dp1 and dp2 at the same slot. The E2E contract says "seeds a plan with a shared teacher placed in both cohorts," but switching is navigation and editing is one-cohort-at-a-time, so the spec requires a teacher with courses in both cohorts to exist in the e2e fixtures. The plan doesn't confirm that prerequisite.
- **Fix**: Name the concrete cross-cohort teacher/course pair the spec uses (or note one must be provisioned), so the seed prerequisite is explicit rather than discovered mid-implementation.
- **Decision**: FIXED — Phase 3 §1 gained a "Seed prerequisite" note requiring confirmation/provisioning of a cross-cohort teacher and describing the one-cohort-at-a-time edit flow.
