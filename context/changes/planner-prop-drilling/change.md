---
change_id: planner-prop-drilling
title: Planner prop drilling
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Prop design / drilling (PlannerGrid)

- **Triple-declared 14-field cell wiring; PeriodRow is a pure pass-through.** `PlannerGrid.tsx:34-87` (Grid), `:89-147` (PeriodRow re-declares the identical type), `:126-142` (construction). The set `{ onRemove, onSetWeek, onToggleBundle, onRemoveBundle, onInspect }` + `names, collisions, dropHints, hintMode, isOverridden` is declared **three times verbatim**; PeriodRow only re-emits. Lower-risk fix: bundle the 5 stable callbacks into one `handlers` object (a `CellHandlers` type) built once in `PlannerBoard`. Higher-leverage: a small `PlannerGridContext` for handlers + `names` + `hintMode`, shrinking SlotCell's surface to genuinely per-cell data.
- **Whole `names: Record<string,string>` map handed to every cell.** `PlannerGrid.tsx:73,107,132`; `SlotCell.tsx:20,100-101`. Each of ~50 cells receives the full map and uses only its occupants'. Stable reference (doesn't break memo) but couples every cell to global state. `groupByCell` (`PlannerGrid.tsx:154`) already has `names` and sorts by it — it could attach the resolved `name` onto each occupant, so SlotCell/PlacedChip never see the map and the `names[id] ?? id` fallback stops being duplicated across grid/chip/dialog.
- **PeriodRow prop type is a copy of Grid's.** `PlannerGrid.tsx:103-117`. Extract a shared `CellWiring` type and spread; pairs with B1.