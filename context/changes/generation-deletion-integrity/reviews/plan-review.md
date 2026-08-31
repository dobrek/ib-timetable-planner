<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Generation Deletion Integrity

- **Plan**: context/changes/generation-deletion-integrity/plan.md
- **Mode**: Deep
- **Date**: 2026-08-31
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS after F1 fix |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | PASS |

## Grounding

10/10 paths ✓, 12/12 symbols ✓ (one line-ref cited the wrong scenario — F2), brief↔plan ✓, Progress↔Phase ✓. Verified directly: `isDeliverableJob`/`isSweepableJob` shapes, both FKs `on delete set null`, strip final `return null`, `markPending`→`insertJob` ordering, `stalenessCutoff` barrel export, `plans.created_at`, test anchors `:371`/`:409`/`:270-296`, `markDelivered` as the sole writer of `delivery`. The `created_at` race guard is provably sound: a genuine orphan's clone is strictly older than the stale job whose staleness permitted the source deletion.

## Findings

### F1 — The hub badge is a fifth consumer, and it re-creates the misreport

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 / Implementation Approach ("defuses D2 at every consumer at once")
- **Detail**: After Phase 1, the delivered-then-deleted row (succeeded, `delivered_plan_id=null`, `proposal_plan_id=null`, `delivery='proposal'`) matches `surfacedJobsFor`'s second filter arm (`generation-status.ts:88-91`), and `toGenerationIndicator` derives `delivered` from `delivered_plan_id !== null` — so the hub (SSR loader + 5 s poll) badges the SOURCE "Finished — open to deliver" forever. Today the false `failed` flip is what hides that row from the filter; removing the flip exposes it, swapping one permanent misreport for another.
- **Fix A ⭐ Recommended**: Add `delivery` to the hub projection + `GenerationJobStatusRow`, conjoin `delivery.is.null` into the filter's second arm, and drop `delivery !== null && delivered_plan_id === null` rows at the `toGenerationIndicator` mapping edge (heals the unfiltered `refreshKnown` path — open tabs clear on the next tick). Not on `delivery` alone: delivered-unnotified rows are legitimate "Ready — open" material.
- **Fix B**: Server-filter only — one line, but open hub tabs keep the stale badge until reload.
- **Decision**: FIXED (Fix A — plan change 6 added to Phase 1, integration + unit test cases, manual criterion 1.7, Current State bullet, brief updated)

### F2 — The `:259` citation names the wrong scenario

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2, change 3 (integration coverage)
- **Detail**: `plan-actions.integration.test.ts:259` is the stale-PROPOSAL deletion test; no existing test pins deleting the SOURCE with a stale-running job. The behavior holds by code (`assertNoActiveJob` skips stale rows) but was unpinned.
- **Fix**: Correct the citation; note the planned end-to-end orphan case pins the source-side behavior for the first time.
- **Decision**: FIXED
