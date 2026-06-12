# Group Dragging — Plan Brief

> Full plan: `context/changes/group-dragging/plan.md`
> Research: `context/changes/group-dragging/research.md`

## What & Why

Add whole-group drag-and-drop to the plan board: dragging a grouping's header onto a slot cell fans its member courses into that cell as N ordinary per-course placements. This closes a deliberate S-01 deferral — the original design already resolved that "dropping a grouping is a bulk-drop convenience," and the architecture (accept-and-flag validation, discriminated drag union) was built to absorb it.

## Starting Point

Today only individual courses drag: palette rows and placed chips are draggables, slot cells the sole droppable, with optimistic single-row persistence through an idempotent `createPlacement` action. The `GroupingBox` header is a collapse toggle and "never drops as a unit" (its own doc comment). Validation is accept-and-flag — drops always land; `deriveCollisions` flags conflicts over the whole board after every change.

## Desired End State

The grouping header is a drag handle: drop it on a cell and every member not already there appears as a pending chip, settling into real placements. Collapse is gone — members are always visible and the header's only job is dragging. Partial save failures roll back just the failed chips and name them in the error banner. Per-course drag, move, and remove are untouched; after a group drop, every chip is an ordinary individual placement.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Persistence for the fan-out | Option A — N parallel idempotent single inserts | Accept-and-flag tolerates partial success and `insertPlacement` is already idempotent; no new server surface. | Research (resolved in change.md) |
| Pre-drop group validation | None — reuse accept-and-flag | Groupings are conflict-free by construction; `deriveCollisions` already validates the whole board post-drop. | Research |
| Partial-failure UX | ErrorBanner naming the failed courses ("2 of 6 failed: …") | Reuses the existing error surface while telling the author exactly what to re-drag. | Plan |
| Duplicate members in target cell | Silent skip (full duplicate = no-op) | Matches today's silent single-course duplicate behavior; the cell already shows those chips. | Plan |
| Multi-hour semantics | One hour per member per drop | Mirrors the per-course gesture; "fill the week" would be a scheduling algorithm, not a drag. | Plan |
| Group-drag affordance | Remove collapse; whole header is the draggable | Collapsed headers were indistinguishable anyway; a single-purpose header kills click-vs-drag ambiguity and shrinks the dnd-kit risk. | Plan (user-proposed) |
| Drag feedback | Custom `DragOverlay` clone + in-place "in use" box | Default feedback left an empty palette gap and a bounce-back on drop; now the source box stays in place (dimmed, dashed border) while a compact box clone with all member names follows the pointer. | Plan (amended twice in Phase 1) |
| dnd-kit 0.4 (pre-1.0) risk | Verify-while-wiring: Phase 1 ends with a manual drag-behavior checkpoint | Catches any pointer-capture quirk before batch state is built on top, with no throwaway spike. | Plan |

## Scope

**In scope:** `GroupDrag` payload variant; GroupingBox rework (collapse removed, header draggable); third `handleDrop` branch; pure batch transitions + tests; `addGroup`/`persistAddGroup` orchestrator; named partial-failure banner.

**Out of scope:** atomic `create_placements` RPC (documented follow-up), "fill the week" placement, custom drag overlay, keyboard/a11y group drag, schema changes, any palette-collapse replacement.

## Architecture / Approach

Group drag is a third variant of the existing `DragData` union flowing through the same `handleDrop` — not a parallel mechanism. The handler resolves member ids from props (payloads stay opaque ids), filters out members already in the cell, applies one batch optimistic state update (so collision/hours derivations recompute once, keeping <200ms), persists via `Promise.allSettled` over the existing idempotent `createPlacement`, then applies one settlement update mixing reconciles and rollbacks. Validation, collision flagging, hours, and the cell droppable are reused unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Drag mechanism + GroupingBox rework | Header drags end-to-end (interim per-member loop); collapse removed | `@dnd-kit/react` 0.4 pointer behavior — gated by the phase-end manual checkpoint |
| 2. Batch state + Option A persistence | Single-update optimistic fan-out, allSettled persistence, named failures | Partial-failure UX clarity — Option B (atomic RPC) is the documented fallback if it confuses |

**Prerequisites:** none — branch `feat/group-dragging` exists; no migrations, no new env.
**Estimated effort:** ~1 focused day across 2 phases, including tests.

## Open Risks & Assumptions

- `@dnd-kit/react` 0.4.x is pre-1.0; sibling header/row draggables should be clean, but the Phase 1 checkpoint exists precisely to confirm before building further.
- Assumes silent duplicate-skip won't surprise authors (the cell visibly contains the skipped chips); revisit only if feedback says otherwise.
- N parallel inserts mean partial success is possible by design; if the named-banner UX proves confusing in practice, the atomic-RPC follow-up is already specced in research §3.
- The parallel-idempotent-insert assumption has no integration test — coverage is deliberately deferred to end-to-end testing (author decision, 2026-06-12).

## Success Criteria (Summary)

- An author schedules a whole grouping into a slot with one gesture, and every resulting chip behaves like any individually placed course.
- Conflicts, hours, and pending states react to a group drop exactly as they do to single drops — instantly and correctly.
- Failures never lie: chips that didn't persist disappear and are named; nothing is silently half-saved.
