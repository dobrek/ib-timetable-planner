# PlannerGrid Prop Drilling — Plan Brief

> Full plan: `context/changes/planner-prop-drilling/plan.md`
> Research: `context/changes/planner-prop-drilling/research.md`

## What & Why

The planner grid threads a whole `names` map and a whole `CellCollisions` record down four component layers to ~50 cells, where each chip uses only its own name and three membership checks; the cell wiring is also declared three times verbatim. We resolve each occupant's name + collision flags **once at grouping time** into a `CellOccupant` view-model (Option A) and extract a shared `CellWiring` type (Option 0), so each component receives only genuinely per-occupant data and the wiring is declared once. Pure readability/maintainability refactor — no behavior change.

## Starting Point

`PlannerGrid.groupByCell` already holds `names` and sorts occupants; `PeriodRow`/`WeekLane` are pure pass-throughs; `PlacedChip` resolves name + flags inline from whole-record props; `SlotCell` reads `CellCollisions` only for cell tone. Week helpers are generic and called only in `SlotCell`. The `slot-cell-refactor` explicitly deferred this work.

## Desired End State

`SlotCell`/`WeekLane`/`PlacedChip` receive `CellOccupant[]` — never the `names` map or a `CellCollisions` record. Name + `blocking/warning/unavailable` flags are resolved once in a tested pure function in `model/`. The grid↔row wiring is one `CellWiring` type. UI behaves identically; all gates stay green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Option 0 + A only | Highest cleanliness-per-risk; B/C/D need stable callbacks or a measured perf case. | Research |
| View-model shape | Nested composition `{ placement, name, flags }` | Keeps identity tokens separate from display per the lessons.md rule. | Plan |
| Resolution depth | Name **and** collision flags | Removes both whole-record props; `cell.hasBlocking ≡ occupants.some(o=>o.blocking)` is exact. | Plan |
| Week helpers | Generalize with a `weekOf` selector | One implementation, no duplication or dead code, sole-caller is `SlotCell`. | Plan |
| Tests | Unit-test the pure resolver only | Tests the moved logic at the right altitude; the grid has no e2e/DOM coverage, so the JSX repoint rests on `pnpm check` + a deliberate manual pass. | Plan |
| Phasing | Single phase | Option 0 is a trivial type extraction; fold it in with the rewire. | Plan |

## Scope

**In scope:** new `model/cell-occupants.ts` (`CellOccupant` + `groupCellOccupants` + test); generalize `week.ts` helpers; rewire `PlannerGrid`/`PeriodRow`/`SlotCell`/`WeekLane`/`PlacedChip`; extract `CellWiring`.

**Out of scope:** callback bundling (B), `PlannerGridContext` (C), `React.memo` (D); stabilizing model hooks; `PlannerBoard` prop origins; the four board-level `names` siblings (palette, error banner, collision dialog, group overlay).

## Architecture / Approach

`groupCellOccupants(placements, names, collisions)` builds a `Map<cellKey, CellOccupant[]>` once at the grid top. The grid threads only `CellOccupant[]` + per-cell scalars (`dropHint`, `hintActive`, `hintMode`, `bundled`) + handlers downward. `SlotCell` derives tone from occupant flags and partitions week lanes via the generalized helpers; `PlacedChip` reads pre-resolved fields off the occupant.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. View-model + wiring type | `CellOccupant` resolution end-to-end, `names`/`CellCollisions` dropped from cell/chip surface, single `CellWiring` type | Mis-threading a chip field during the nested-shape repoint (`occupant.placement.*`) — caught by `pnpm check` + e2e |

**Prerequisites:** none.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Nested composition adds `occupant.placement.*` indirection at every chip field read — a mechanical but broad edit; type-check is the guard.
- Behavior preservation has no e2e/DOM safety net for the grid (the e2e suite covers auth + the catalog table only); it rests on `pnpm check`, the resolver unit test, and a deliberate manual pass. `pnpm check` does not catch a same-typed field swap, so the manual step explicitly verifies chip names-not-ids and the dialog's course target.

## Success Criteria (Summary)

- Chips, badges, tones, week lanes, and drag-drop behave exactly as before.
- `SlotCell`/`WeekLane`/`PlacedChip` no longer reference `names` or `CellCollisions`; wiring declared once.
- `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm steiger`, `pnpm build` all green.
