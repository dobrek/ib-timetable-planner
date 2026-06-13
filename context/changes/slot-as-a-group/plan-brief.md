# Slot-as-a-group (Slot Bundles) — Plan Brief

> Full plan: `context/changes/slot-as-a-group/plan.md`
> Research: `context/changes/slot-as-a-group/research.md`

## What & Why

Treat all courses in a `(day, period)` slot as **one group**: move them together, remove them together. Courses are **grouped by default** (opt-out); an inline lock-icon toggle ungroups a slot to operate on individual chips again, and re-groups it. This replaces the current behavior where co-located placements share a cell with no binding — you can only drag/remove one chip at a time.

## Starting Point

A "slot" has no row today — it's the implicit coordinate `(plan_id, cohort, day, period)`, already the unit of the `placements_unique` key, the `cellKey` collision bucketing, and per-cell rendering. Multiple placements legally share a cell with no link between them. The board already has an optimistic-batch idiom (`addManyOptimistic`/`settleMany`) for fanning a palette grouping into N placements, and a whole-group drag precedent (`GroupingBox` header handle + `GroupDragOverlay`).

## Desired End State

Any slot with ≥2 courses is a bundle: chips render without a per-chip "×" and aren't individually draggable, the cell shows a faint containment cue, and a header strip (lock icon + trash icon) doubles as a whole-slot drag handle. Dragging the header moves all courses to another slot as one unit; the trash icon bulk-removes them; the lock icon toggles ungroup/regroup. Grouped/ungrouped state persists in Supabase and survives reload and plan clone.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Naming | `slotBundle` / `slot_bundles` / `kind:"bundle"` | Zero collision with the saturated `grouping`/`addGroup` vocabulary | Research |
| Default state | Opt-out: row = unbundle override | Matches "automatically grouped, with an option to ungroup" | Research |
| Persistence | Coordinate-keyed marker table | The slot is already identified by `(plan,cohort,day,period)` everywhere | Research |
| Move/remove | Best-effort client batch, no atomic RPC | Mirrors the resolved Option-A group fan-out; partial failure tolerated | Research |
| Table writes | Only the toggle writes `slot_bundles` | Move/remove are pure placement ops; destination state wins | Research |
| Cohort | Cohort-keyed table, dp1-only UI | dp2-ready schema without shipping dp2 UI | Research |
| Override GC | None (sticky) | "Stays ungrouped until I regroup it"; cruft negligible (≤84 cells) | Research |
| Constraints | Untouched | A bundle move is the set-union of N placement moves | Research |
| Drag handle | Header strip | Reuses the proven `GroupingBox` `handleRef` pattern | Plan |
| Row shape | Pure presence-marker (no boolean) | Simplest under fixed opt-out; clones as a plain coordinate copy | Plan |
| Grouped look | Lock icon + hidden "×" + faint gated cue | Signals locked + grouped + "one unit" without fighting existing rings | Plan |
| Toggle UX | The lock/link icon **is** the toggle | Collapses indicator + primary action into one control | Plan |
| Remove-all | Inline trash icon, grouped-only, no confirm | Direct, minimal-chrome; consistent with the no-confirm per-chip "×" | Plan |
| Test scope | Unit + integration | Cover pure logic fast; prove clone + actions end-to-end | Plan |

## Scope

**In scope:** persisted slot-bundle overrides; whole-slot move + bulk-remove; lock-icon group/ungroup toggle; grouped visual (icon + hidden ×, faint cue); clone support; dp1.

**Out of scope:** constraint-core changes; partial-slot bundles; atomic move/remove RPC; grouping identity on placement rows; dp2 UI; override GC; confirmation/undo; `dropdown-menu` for this feature; a `grouped` boolean column.

## Architecture / Approach

A new `slot_bundles` table records *unbundle overrides* by coordinate; `isBundled(cell) = occupants ≥ 2 && !hasOverride(cell)`. The table is written **only** by the lock-icon toggle (via a new single-row action pair). Bundle move/remove are pure placement operations over the existing optimistic-batch transitions, applied in a **single** `setPlacements` update so the board never renders a transient mid-move state. A new `useSlotBundles` hook (mirroring `usePlacements`) owns optimistic override state; `SlotCell` grows a header that is both the toggle/trash control surface and the whole-slot drag handle; `GroupDragOverlay` gains a `bundle` branch; `drop-hints` gains a multi-exclude so a whole-slot drag previews correctly.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Persistence backbone | `slot_bundles` table + RLS, `clone_plan` edit, types, action pair + client, `load.ts` seeding | Clone edit / RLS / type regen mistakes; caught by the integration test |
| 2. Model & state | `bundle` drag kind, pure `slot-bundle` logic, `useSlotBundles`, batch move/remove transitions, multi-exclude hints | Batch move must be one state update (no flicker); merge skip-same-course correctness |
| 3. UI & interaction | `SlotCell` header (toggle + trash, drag handle), grouped cue, inert chips, overlay branch, `handleDrop` wiring | Toggle/trash buttons vs drag-handle coexistence; cue gating vs collision/drop rings |

**Prerequisites:** local Supabase running (Docker) for `db reset` + integration tests; current `main`.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Bundle move correctness hinges on a single optimistic `setPlacements`; doing it per-placement would reintroduce mid-move collision flicker.
- Best-effort batch means partial failure is possible; it's surfaced and the board self-heals on the next recompute (no atomic RPC unless this proves confusing).
- The header strip must host two interactive buttons *and* serve as the drag handle — needs careful `stopPropagation`/activator handling.

## Success Criteria (Summary)

- A ≥2-course slot auto-bundles; the whole slot moves and bulk-removes as one unit; the lock icon toggles ungroup/regroup.
- Grouped/ungrouped state persists across reload and is carried by `clone_plan`.
- No constraint regressions and no perceptible drag lag (<200 ms budget preserved; no mid-move flicker).
