# Collision-Free Slot Hints — Plan Brief

> Full plan: `context/changes/collision-free-slots/plan.md`
> Research: `context/changes/collision-free-slots/research.md`

## What & Why

When the user starts dragging a course, a placed chip, or a whole grouping, the planner grid immediately marks which time-slot cells the drag could land in without a collision — guiding the eye *before* the drop. Collision feedback today is post-drop only; this adds an upfront, advisory hint that makes valid targets obvious while the board fills up.

## Starting Point

The constraint core already exposes a pure what-if predicate (`violatesAny`) and no-op guards (`canAdd` / `moveIntent`); all inputs are client-side island props; and `collisions` already threads `PlannerBoard → PlannerGrid → SlotCell`. The drag provider wires only `onDragEnd`, there's no "valid target" theme token, and `violatesAny` has never been consumed by the drag UI. The board is dp1-only.

## Desired End State

On drag start the grid classifies every cell as **free / partial / blocked** for the dragged member-set and renders it under a user-chosen encoding — **dim-the-blocked** (default) or **highlight-the-free** — persisted per-device. Partial appears only for group drags where some-but-not-all members fit. Marks clear on drop or cancel, stay correct if placements settle mid-drag, and the sweep stays far under the 200ms budget. Drops still always land (accept-and-flag is untouched).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Hint is gate vs advisory | Advisory only | Accept-and-flag is a locked PRD decision; hints never block a drop. | Research |
| Reuse vs new validation | Reuse `violatesAny` registry | Hint and detector derive from one registry, so they can't drift; future constraints inherited free. | Research |
| Visual encoding | Both, behind a user toggle | Dim-blocked keeps signal sparse on empty grids; highlight-free is a clearer affordance — let the user pick. | Plan |
| Default encoding | Dim-blocked | Empty early-planning grids would flood with ~50 highlights otherwise. | Plan |
| Partial-group cells | Ternary: free / partial / blocked | A partial cell still lands the fitting members, so marking it fully blocked would be dishonest. | Plan |
| No-op cells (duplicate / move origin) | Mark as blocked | Honest dead-end affordance; needs `canAdd` + same-cell-origin awareness, not just `violatesAny`. | Plan |
| Toggle persistence | `localStorage` (`planner-drag-hint-mode`) | Matches the existing per-device `theme` / `sidebar-collapsed` precedent; no Supabase justified. | Research |
| Test coverage | Derivation unit tests + `onDragStart` resolution test | Concentrates testing on the pure logic where exclusion/ternary bugs hide. | Plan |

## Scope

**In scope:** `onDragStart` capture; pure `deriveDropHints` + `resolveDragHintContext`; threading the map to cells; ternary visual states; new `--valid` token; board toggle + localStorage persistence; unit tests.

**Out of scope:** any drop gate; server/API/data changes; new constraint logic; cross-cohort hinting; conflict-matrix precompute / `React.memo`; per-account (Supabase) preference; drag-over/per-hover recomputation.

## Architecture / Approach

Three layers. **Model**: `deriveDropHints(context, placements, catalogById)` returns a *sparse* `Map<cellKey, "partial" | "blocked">` (absent = free, `null` = no drag), reusing `violatesAny` for collisions and `canAdd` + forced-origin for no-op dead-ends; placement-move exclusion handled inside; a `resolveDragHintContext` resolver turns a `DragData` into `{ members, excludePlacementId?, origin? }`. **Wiring**: `PlannerBoard` stores drag context from `onDragStart`, a `useDropHints` `useMemo` derives the map, threaded to cells like `collisions`. **Presentation**: a new semantic token, a ternary `cn(...)` branch in `SlotCell` switched by mode, and a persisted board toggle. The derivation is encoding-agnostic — the mode only chooses which side gets ink.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure derivation + resolver | `deriveDropHints` + `resolveDragHintContext`, fully unit-tested | Getting placement-move exclusion + forced-origin-blocked right |
| 2. Drag-start wiring + threading | `onDragStart` capture, `useDropHints`, map threaded to cells (`data-` only) | Clearing context on both drop and cancel |
| 3. Encoding, toggle & persistence | New `--valid` token, ternary rendering, board toggle + localStorage | Token legibility in light/dark; coexistence with hover/collision styles |

**Prerequisites:** none — all inputs already in client memory; no migrations.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Marks recompute if a pending placement settles/rolls back mid-drag — judged acceptable (correct, and cheap) rather than jarring.
- The new `--valid` token's light/dark oklch values need a quick design pass for legibility.
- Per-device persistence (not per-account) is acceptable for a cosmetic toggle.

## Success Criteria (Summary)

- Dragging a course / chip / grouping marks free, partial, and blocked cells correctly; a moved chip's origin reads blocked.
- The toggle flips dim-blocked ↔ highlight-free and survives a reload; the empty grid isn't flooded by default.
- `pnpm verify` (lint + steiger + test + build) stays clean; sweep stays under the 200ms budget.
