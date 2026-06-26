<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bundle Duplication

- **Plan**: context/changes/bundle-duplication/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-26
- **Verdict**: APPROVED
- **Findings**: 0 critical · 0 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence Summary

- 13 files changed (10 planned + 2 documented post-review refactor files: `SlotHeader.tsx` / `SlotHeaderButton.tsx`). Every planned file present. No DRIFT, MISSING, or undocumented EXTRA.
- Gates re-run live during review: `pnpm test` → 597 pass (72 files); `pnpm check` → 0 errors; `pnpm lint` → clean; `pnpm steiger` → clean.
- Integration (`e8dc087`) + E2E (`da34987`) recorded passing in Progress; not re-run here (need Docker + workerd preview).
- All "What We're NOT Doing" guardrails honored — no server/RPC/Zod changes, no `duplicate_bundle` RPC, no hours-overshoot gate, no new `PlacedChip` prop, no per-loose-chip semantics, no companion-dropdown work.
- Copy-vs-move context correct (no `excludePlacementIds`/`origin`); week-faithfulness read before dispatch; pulse uses `ring-ring` semantic token, `motion-safe:`-gated; anchor-after-source + wrap math verified against tests.

## Findings

### F1 — Stale comments still claim scroll-into-view behavior

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: PlannerGrid.tsx:26, use-placements.ts:142
- **Detail**: scroll-into-view was removed in commit `1b2a57e` (recorded in change.md), but two comments still described the cell as scrolling ("pulses + scrolls" / "scrolls + pulses"). No dead code — the `scrollIntoView` call is gone; only the comment text was stale.
- **Fix**: Drop the "scrolls" wording from both comments so they describe the pulse only.
- **Decision**: FIXED — both comments updated (PlannerGrid.tsx:26 → "pulses"; use-placements.ts:142 reworded, combined with F2).

### F2 — Highlight pulses an empty cell if the copy's fan-out fully fails

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: use-placements.ts:173-178
- **Detail**: `duplicateBundle` sets `lastDuplicated` (fires the pulse) synchronously right after the fire-and-forget `addGroup()`. If every `place_course` in the fan-out fails, `settleMany` drops the optimistic rows and empties the target cell — but the `justDuplicated` ring + `motion-safe:animate-pulse` still plays on the now-empty cell for ~1200ms. The error banner surfaces correctly; cosmetic and a rare path (the client-side conflict-free search precedes the write). Gating the pulse on settle would add complexity for a near-impossible case. The only real gap was the comment implying unconditional success.
- **Fix**: Tweak the use-placements.ts:142 comment to note the highlight fires optimistically (on dispatch, before settle). No behavioral change.
- **Decision**: FIXED — comment now states it pulses optimistically before the fan-out settles (combined edit with F1).
