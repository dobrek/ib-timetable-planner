<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Plan Generation

- **Plan**: context/changes/plan-generation/plan.md
- **Scope**: Full plan (Phases 1–5, all complete)
- **Date**: 2026-07-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations
- **Note**: The greedy search engine, worker precondition, `types.ts` diagnostics, and
  the fuzz harness were reworked by the follow-up `generation-engine-hardening` change
  (archived 2026-07-12) and were held **out of scope** here — this review covers the
  plan-generation-owned persistence, history, verify, snapshot, and UI layers.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated re-run on the current tree: `pnpm check` 0/0/0 · `pnpm steiger` clean ·
targeted `pnpm test` (generation/history/apply/UI) green · apply-generated integration
suite green.

The highest-risk artifacts were verified clean directly: the atomic
`apply_generated_placements` RPC (one transaction, `week`/`is_optional` converged on
retained rows keeping their ids, find-or-create copied from the latest-live `place_course`
per the lessons rule, no injection surface); `verify.ts` (fresh indexes, wholesale
rejection, all structural invariants); the two-cohort history entry + batch reconcile
recognizer; token-clean UI + correct worker lifecycle.

## Findings

### F1 — Board editable during the ~20 s solve; a concurrent edit could commit a board verify never judged

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/_pages/plan-detail/model/use-cohort-board-state.ts:137,169 · src/_pages/plan-detail/model/generation/apply-generated.ts:35
- **Detail**: The engine verifies its result against the click-time snapshot, but the board is only gated on `combinedBusy` (pending writes), which is false during `solving`. `applyGenerated` captures `before` at apply time and commits `before ∪ generated` via the region RPC — so a concurrent edit landing a conflicting row (same cell, or a cross-cohort/same-student/teacher clash) between click and apply produces a board `verifyGeneration` never judged, breaking the "nothing invalid touches the board" guarantee. Mitigated: live collisions flag any clash red, single-undo reversible, no data loss.
- **Decision**: FIXED via Fix A — apply-time re-verify. Added `liveState()` to the placements API (reads the live refs); `applyGenerated` now assembles the live board and runs `verifyGeneration(liveSnapshot, generated)` before staging, aborting with `{ ok: false, reason: "stale" }` on failure; the hook surfaces "The board changed while generating — nothing was applied. Generate again." Preserves the responsive-board criterion (4.12) — edit/cancel still work — and enforces the same clean-board guarantee the block-until-clean gate gives at click time. Regression test added to `use-generate-plan.test.tsx`.

### F2 — Manual check 5.2 overstated: an auto-placement non-goal reference still remained in context/foundation/

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/shape-notes.md:509
- **Detail**: Progress 5.2 is checked "No auto-placement non-goal reference remains in context/foundation/", but `shape-notes.md:509` still listed "End-to-end automatic timetable optimization / auto-placement" unstruck. `prd.md:515` (reversed) and `roadmap.md:212` (un-parked) are correctly amended; shape-notes is a pre-PRD input snapshot, so the governing docs were right and only the wording was overstated.
- **Decision**: FIXED — annotated `shape-notes.md:509` as struck + "_Reversed by the `plan-generation` change (2026-07-11) … see PRD FR-016 and roadmap.md_", making the whole tree consistent.

### F3 — Merge-undo now executes atomically via apply_generated_placements (documented, benign broadening)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — informational
- **Dimension**: Scope Discipline
- **Location**: src/_pages/plan-detail/model/history/use-reconcile-executor.ts:117,123-132 · src/_pages/plan-detail/model/history/reconcile-exec.ts:50-55
- **Detail**: Because the executor now always supplies `region` + `applyGeneratedRegion`, any multi-cell board-only reconcile — notably merge-undo — now routes through the atomic region RPC instead of the decomposed place/remove sequence. Documented in code, strictly safer (atomicity), region built from the COMPLETE target slice so untouched rows are preserved. Recognizer dispatch is unit-tested; the RPC is integration-tested.
- **Decision**: FIXED — added an explicit merge-undo-shape assertion to `apply-generated.integration.test.ts` (a multi-cell board-only region relocates a pre-existing row atomically, dropping the emptied source). Integration suite green (6 tests).
