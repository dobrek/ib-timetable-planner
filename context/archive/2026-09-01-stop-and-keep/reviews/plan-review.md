<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Stop & keep (S-305) Implementation Plan

- **Plan**: context/changes/stop-and-keep/plan.md
- **Mode**: Deep
- **Date**: 2026-09-01
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

15/16 paths ✓ (the miss became F1), 6/6 symbols ✓, cited line ranges spot-checked ✓, brief↔plan ✓.
Deep verification confirmed all 5 riskiest claims: heartbeat piggyback (`_Heartbeat._beat` calls
`progress`; both call sites tolerate the `None → dict | None` return change), app-write legitimacy
(`authenticated` table-wide UPDATE, `using(true) with check(true)`, CHECK admits `stopped`),
"stage k of 10" copy (`LADDER_TIER_COUNT` exported from `@/entities/timetable`; the strip already
uses it), pending-page mechanics (active panel, destructive terminal branch, `checkPlan` tick
already delivers/sweeps stopped rows), and blast radius (`stop_requested_at` has zero runtime
readers/writers today; the view field addition is additive for all consumers).

## Findings

### F1 — Wrong path for the delivery integration suite

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Changes #4 and Automated Verification
- **Detail**: Phase 2's criterion ran `pnpm test:integration src/test/generation-delivery.integration.test.ts` — no such file; the suite is co-located at `src/_pages/plan-detail/api/generation-delivery.integration.test.ts` (its lines 236–267 hold the two stopped-row tests the plan cites). The new stop suite was likewise placed in `src/test/` while the suite it mirrors is co-located.
- **Fix**: Correct the criterion path; co-locate the new suite as `src/_pages/plan-detail/api/generation-stop.integration.test.ts`.
- **Decision**: FIXED (paths corrected in Phase 2 changes, criteria, and Progress 2.2)

### F2 — Phase 3 rewrites the page the E2E suite drives, but no phase runs the E2E lane

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 — Success Criteria
- **Detail**: `e2e/specs/generation.spec.ts` (S-306) drives the pending proposal page — the component Phase 3 restructures. CI's e2e job runs it on every push, but the plan never mentioned the e2e lane (`/verify` stops at build), so a selector/copy break would surface only in CI.
- **Fix**: Add `pnpm test:e2e e2e/specs/generation.spec.ts` to Phase 3's Automated Verification and Progress.
- **Decision**: FIXED (criterion added; Progress row 3.3 inserted, manual rows renumbered 3.4–3.7)

### F3 — Dead "queued" member in the fallback filter

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Changes #1, fallback write
- **Detail**: The fallback filtered `.in("status", ["queued", "running"])`, but after a missed `queued` CAS the row can never be `queued` — and a flag on a queued row would be exactly the write-into-a-void state C4 warns about.
- **Fix**: Narrow the fallback to `.eq("status", "running")`.
- **Decision**: FIXED (filter narrowed, with a one-line rationale in the plan)
