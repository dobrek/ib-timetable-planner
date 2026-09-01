<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Hub-badge eviction + shared polling-store factory (F6)

- **Plan**: context/changes/extract-share-polling-store/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Evidence highlights: all 16 planned items MATCH including the D9 afterTick ordering and D8 ungated
visibility tick (both pinned by factory tests); eviction failure boundary correct (failed fetch
rejects → snapshot kept; only a successful empty answer evicts); the row-indicators/PlansHub extras
are the change.md-documented Phase 1 adaptation; all automated criteria re-verified firsthand
(1784/1784 tests, lint, steiger, check, build, both greps, no test-file edits in commit 2).
Plan-estimate misses (11/15 not 14/15 hub tests untouched; factory suite 347 vs ~150–200 lines)
are over-delivery, not drift.

## Findings

### F1 — Snapshot keyed by source planId drops one of two coexisting jobs on the same source plan

- **Severity**: ⚠️ WARNING (pre-existing — not introduced here)
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plans-list/model/job-progress-store.ts:97
- **Detail**: indexByPlan keys the snapshot by source planId (one indicator per source plan). The uniqueness guard (generation-job.ts:183) only blocks concurrent ACTIVE jobs, so a terminal-undelivered "Ready" job plus a newly started running job on the same source is a legal server state; the Map keeps only the last, losing the "Ready" badge for the second run. Pre-dates both commits; replace semantics make the collapse permanent rather than transient.
- **Fix A ⭐ Recommended**: Record the one-job-per-source assumption at indexByPlan and queue a rekey-by-jobId follow-up.
  - Strength: Zero behavior risk today; the case is rare and cosmetic.
  - Tradeoff: Lost-badge window ships as-is until the follow-up.
  - Confidence: HIGH — cheap comment, follow-up flow exists.
  - Blind spot: Regenerate-before-opening frequency unknown.
- **Fix B**: Rekey by jobId now (adjust sameIndicators, indexByPlan, indicatorsForRow).
  - Strength: Removes the collapse class entirely.
  - Tradeoff: Touches the just-stabilized store + row helper + suites; multi-badge-per-row display policy must be designed.
  - Confidence: MEDIUM — rekey mechanical, display policy undesigned.
  - Blind spot: UI treatment for multiple indicators per row could balloon.
- **Decision**: FIXED (Fix A — assumption docblock at indexByPlan + rekey-by-jobId queued in follow-ups/review-fixes.md)

### F2 — Empty-answer eviction is safe only because auth failures throw — undocumented invariant

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plans-list/model/job-progress-store.ts (refresh docblock)
- **Detail**: Mass-eviction on an empty answer is authoritative only while unauthenticated action calls are rejected (middleware deny-by-default), not RLS-filtered to zero rows. An allowlisted actions route + expired session would 200-with-empty and evict every badge.
- **Fix**: One sentence in refresh's docblock: "an empty answer is authoritative because an unauthenticated call throws, not filters."
- **Decision**: FIXED (invariant sentence added to refresh's docblock)

### F3 — Refocus tick swallowed when a read is in flight; docblock rule 5 slightly overstated

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/shared/lib/polling-store/polling-store.ts:126
- **Detail**: The visibility tick passes through the inFlight guard; a focus arriving during a read is skipped, and for a discovery-only snapshot no timer follows to catch up. Pre-existing behavior; only the hub's rule-5 wording ("one request per tab-focus") overstates it.
- **Fix**: Soften rule 5 to "at most one request per tab-focus".
- **Decision**: FIXED (rule 5 softened to "at most one request per tab-focus" with the in-flight note)

### F4 — 5000 ms interval constant exists in three places

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: polling-store.ts:165, job-progress-store.ts:64, use-pending-proposal.ts:54
- **Detail**: Factory-private default, hub's exported constant, and PENDING_POLL_INTERVAL_MS all say 5000; both consumers pass intervalMs explicitly, so the factory default is exercised by one test only.
- **Fix**: Export the factory default through the barrel; consumers reference it (hub re-exports to keep its surface).
- **Decision**: FIXED (factory exports DEFAULT_POLL_INTERVAL_MS via the barrel; hub re-exports, pending derives)

### F5 — sameView omits three GenerationJobView fields

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/generation/use-pending-proposal.ts:119
- **Detail**: checkpointStageIndex, cleanLabel, finishedAt are not compared; a change to those alone would not republish. Latent today (each only moves with a compared field); comparer unchanged by this refactor.
- **Fix**: Comment naming the invariant, or add the three fields to the comparison.
- **Decision**: FIXED (three fields added to sameView, incl. structural sameCleanLabel — cleanLabel is a fresh object every tick, so === would have defeated the equality gate)
