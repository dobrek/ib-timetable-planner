---
change_id: combined-view-park-gap
title: Park a palette course or grouping directly onto the shelf in the combined view
status: implemented
created: 2026-06-27
updated: 2026-06-27
archived_at: null
---

## Notes

### What this is about (the bug)

In the combined two-cohort view (`/plans/[id]/combined`), dragging a **palette course or grouping
directly onto the shelf does nothing** — the drag is silently dropped on the void. The single-cohort
board supports this (it parks the course/grouping). This is a gap, not a design choice: the combined
view should behave the same as the single view.

- `model/combined-drop.ts:30,32` — `resolveCombinedDrop` returns `null` for course→shelf and
  grouping→shelf.
- `ui/PlannerBoard.tsx:124,132` — the single board parks them (`parkToShelf(...)`).

Discovered during the `plan-detail-refactor` prep; see that change's `research.md` (parity matrix in
§C) for the full analysis.

### Expected outcome (what "done" looks like)

In `/plans/[id]/combined`, dragging a palette course or grouping onto the shelf **parks it**, exactly
mirroring the single-cohort board:

- It parks under the **palette's currently active cohort** (DP1/DP2).
- The resulting parked card is **tagged with that cohort** and is **place-back routable** to that
  cohort's board.
- The shelf auto-collapses unless pinned (same `collapseUnlessPinned` behavior as the single board).
- All other drops are unchanged; no regressions to existing combined-view behavior.

The bug is fixed.

### What we already know about how to fix it

- **Router:** extend `resolveCombinedDrop` with a third `activeCohort: Cohort` arg — the only cohort
  signal for a cohort-free palette drag dropped on the cell-less shelf (`CombinedPlannerBoard` already
  holds `paletteCohort`, `ui/CombinedPlannerBoard.tsx:43`). Add `parkCourse` / `parkGroup` action
  variants returned for course→shelf and grouping→shelf, tagged with `activeCohort`.
- **Board wiring:** handle the new actions in `CombinedPlannerBoard.handleDrop` by resolving members
  and calling the cohort's **already-exposed** `parkMembers` (`model/use-cohort-board-state.ts:167`) +
  `collapseUnlessPinned`.
- **Shared member resolution:** lift `groupingMembers` / `defaultParkedWeek` out of `PlannerBoard`
  into a pure `model/` helper so both boards resolve parked members/weeks identically (the single board
  inlines them today — `PlannerBoard.tsx:174-185`).
- **Tests:** extend `model/combined-drop.test.ts` for the two new variants (incl. the `activeCohort`
  routing); add a combined-route e2e mirroring `e2e/specs/shelf-durability.spec.ts:72,90` (palette
  grouping → shelf park, parked card survives, place-back works).

### Why this is its own PR

Fixing this **first** makes the single and combined boards symmetric, which removes the only
behavioral/risky item from the larger `plan-detail-refactor`. This change produces the **park-capable
`resolveCombinedDrop`** and the **shared member-resolution helper** that the refactor later unifies the
single board onto. So this is the **prerequisite** for `plan-detail-refactor` — sequence it first.

### Guardrails

- Behavior-preserving for every existing drop path; only the two missing branches are added.
- Workers runtime; `pnpm build` clean; steiger green; <200ms drag budget (no constraint-core changes).
- Don't reach for the `plan-detail-refactor` folder restructure here — keep this change minimal and
  shippable on its own; the refactor rebases on top.
