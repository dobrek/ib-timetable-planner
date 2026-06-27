---
change_id: combined-two-cohort-view
title: Combined two cohort view
status: implemented
created: 2026-06-27
updated: 2026-06-27
archived_at: null
---

## Notes

Decisions locked in conversation (2026-06-27), after `research.md`. These resolve the research doc's open questions and the roadmap S-06 design inputs.

**Hard constraint (verified non-breaking):** the existing single-cohort board/route stays untouched. The cross-cohort index is an injected parameter everywhere it's consumed (`use-placements.ts:111`, `collisions.ts:41` with `EMPTY_CROSS_COHORT_INDEX` default), so making it "live" only changes who derives/passes it. Build everything additively.

**Domain-model decisions:**
- **D1 — Live cross-cohort index.** Each cohort column's `occupiedByTeacher` index is derived from the *other* column's live placements and recomputed on mutation (today it's a static SSR snapshot).
- **D2 — Single plan-level orchestrator** owning both cohorts' placement state (scalar `cohort` → state key over the cohort-agnostic pure transitions). **Additive: do NOT migrate the single-cohort board onto it in this slice** — compose/reuse, don't rewrite. Gives S-08 undo a single op-log home later.
- **D3 — One `DragDropProvider` + cohort-scoped droppable/draggable IDs injected at a per-column wrapper** (keep `SlotCell`/`cellKey` cohort-blind — the documented trap). Explicit cross-cohort move guard in the drop handler (FR-008).
- **D4 — Recommendation enumeration week-awareness is OUT of scope** (belongs to S-03; PRD defers it). Leave as-is.
- New combined route `/plans/[id]/combined` with a symmetric loader (both cohorts editable); reuse cohort-blind `SlotCell`.

**UI decisions:**
- **D5 — Paired-column (interleaved) grid.** ONE unified board: each day header spans two sub-columns (DP1 | DP2), periods as shared rows. Chosen because it makes the cross-cohort teacher constraint's related cells spatially adjacent — the one dimension this view exists to surface. Single-cohort boards remain the clean per-cohort reading surface. Needs a new grid-scaffolding component (reuses `SlotCell`).
- **D6 palette — P1: single palette + DP1/DP2 toggle.** Toggle's active cohort doubles as the drag-target signal → dim the sibling cohort's cells during a palette drag (reinforces the FR-008 guard against accidental cross-cohort drops on adjacent cells). Reuses existing palette collapse disclosure.
- **D6 shelf — S1: one shared right-edge drawer, cards tagged DP1/DP2.** Place-back targets the cohort sub-column directly (cohort-scoped droppable + guard route it). Mounted inside the board island (per S-07 archive constraint). Reuses existing pin/disclosure.

**Must-do for the slice:** implement the S-06 `collision-parity.test.ts:395` `it.todo` (co-teaching + bi-weekly + cross-cohort, no false-positive valid); re-verify <200ms with both columns live.

Housekeeping (not blocking, do anytime): correct the stale "re-compute/staleness are S-06" comment in `ComputeGroupingsEmptyState.tsx`; fix roadmap S-04 status drift (detail says `proposed`, code is done/archived).
