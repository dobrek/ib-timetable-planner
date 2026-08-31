<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation Deletion Integrity

- **Plan**: context/changes/generation-deletion-integrity/plan.md
- **Scope**: Full plan (Phases 1–2 of 2)
- **Date**: 2026-08-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Every planned item verified MATCH — no missing or drifted changes. Two deliberate shape deviations,
both sound: the route builds a `checked: { job, failed }` outcome object instead of a mutated boolean
flag, and the "deletePlan of the source succeeds" assertion lives in the plans-list suite (cross-slice
import would be a steiger error), cross-referenced in both files.

Race analysis verified correct: `clone_plan` inserts only `(name, slot_grid_preset)` so every clone is
born with `created_at = now()`; the only writer of `pending_proposal = true` runs milliseconds after
cloning, against the 5-minute grace — the mid-enqueue release scenario is impossible. `checkPlan`
reads both job keys and throws on DB error, so the route's "clean null" is the right license for the
release UPDATE.

Gates: `pnpm test` (1755 ✅), `pnpm test:integration` (192 ✅ single-worker — see F4),
`check`/`lint`/`steiger` clean, `build` clean. Manual criteria all checked with commit shas; each has
a mirroring integration test.

## Findings

### F1 — Barrel-exported release function trusts an unchecked precondition

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/api/release-orphan-proposal.ts:35 (exported via api/index.ts:12)
- **Detail**: The `created_at` guard protects only the enqueue window, not a live solve: a clone whose
  job has run 10+ minutes is older than the grace, so the UPDATE's own predicates would not stop an
  un-pend. Safety rests entirely on the caller having established "no job references this plan" —
  documented but unchecked. Today the route is the only caller and does establish it; the hazard is
  the slice-barrel export — a future caller can invoke it without the checkPlan-null fact, and
  un-pending a mid-solve clone makes it editable (the failure assertNotPending exists to prevent).
- **Fix A ⭐ Recommended**: Add a cheap defensive job-existence check inside the function (one indexed
  generation_jobs read by proposal_plan_id, the jobsWhere shape pending-guards.ts uses), no-op when a
  job exists.
  - Strength: Invariant becomes self-enforcing regardless of caller; one extra read on the rare orphan path only.
  - Tradeoff: Duplicates half of checkPlan's work on the only current call path; plan said "one guarded UPDATE with no extra reads".
  - Confidence: HIGH — query shape and error style have direct siblings.
  - Blind spot: None significant.
- **Fix B**: Remove from the slice barrel; route imports the module path directly.
  - Strength: Zero runtime cost; keeps the plan's "one UPDATE, no extra reads" contract.
  - Tradeoff: Plan specified the barrel export; deep imports are what steiger's public-api rule catches.
  - Confidence: LOW — likely trades a latent hazard for a structure-gate violation.
  - Blind spot: Haven't confirmed steiger's verdict on a deep import from src/pages.
- **Decision**: FIXED via Fix A — defensive proposal_plan_id job-existence check + docstring amendment

### F2 — `delivery` typed `string | null` rather than a vocabulary type

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/entities/timetable/model/generation/job-delivery.ts:30 (also plan-indicators.ts:66, pending-guards.ts:124)
- **Detail**: All three row types take `delivery: string | null`; predicates only null-check it, so
  safe — but the house pattern for `status` narrows at the boundary, and the column has exactly one
  checked value. A shared `"proposal" | null` vocabulary type would document intent and catch a
  typo'd write.
- **Fix**: Add a `GenerationDelivery = "proposal" | null` type in the entity; use it in the three row types.
- **Decision**: FIXED (adjusted) — GenerationJobDelivery vocab type in the entity, enforced at markDelivered via satisfies; read-side rows stay wide by documented design

### F3 — pending-guards docblock keeps the "scope stated as safety" phrasing

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plans-list/api/pending-guards.ts:111
- **Detail**: proposalIsReleasable's docblock still closes with "Once delivered the plan is no longer
  pending, so this guard is not consulted at all" — the phrasing the new job-delivery.ts docstring
  holds up as what hid D2. The claim IS still true here (delivered ⇒ clearPending ran ⇒
  assertNotPending returns early), so it's a stylistic echo, not a bug.
- **Fix**: One-line qualifier explaining why the claim holds here (the pending flag, not the FK, is the discriminator).
- **Decision**: FIXED — qualifier added to the docblock

### F4 — Parallel integration runs flake on the local Supabase gateway

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (local environment)
- **Detail**: Default `pnpm test:integration` failed 7 files on run 1 and 1 file on run 2 with "An
  invalid response was received from the upstream server" — infra-level errors hitting different,
  mostly pre-existing suites each run. Single-worker fully green (33 files / 192 tests); not caused
  by this change. `supabase status` reports pooler and imgproxy stopped.
- **Fix**: Restart the local stack; if parallel flakes persist, investigate as a local-env issue (CI runs --maxWorkers=2 green).
- **Decision**: FIXED (mitigated) — stack restarted; suite verified green at CI parity (--maxWorkers=2) and single-worker. Residual flakes only at full default parallelism (local Kong load limit, pre-existing); use --maxWorkers=2 locally when the default run flakes
