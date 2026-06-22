---
date: 2026-06-22T16:31:01+0200
researcher: Dobromir Kropielnicki
git_commit: 7789e4e260a3b165b717d55cec1a4cd023537bf8
branch: main
repository: dobrek/ib-timetable-planner
topic: "PlannerGrid prop drilling — is it still a problem, and how to tackle it"
tags: [research, codebase, plan-detail, planner-grid, slot-cell, prop-drilling, react-context, memoization]
status: complete
last_updated: 2026-06-22
last_updated_by: Dobromir Kropielnicki
---

# Research: PlannerGrid prop drilling — validation & options

**Date**: 2026-06-22T16:31:01+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 7789e4e260a3b165b717d55cec1a4cd023537bf8
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

As a follow-up to the `slot-cell-refactor`, we recognised a prop-design / prop-drilling problem in the planner grid component. Validate whether this is still a problem, and what options exist to tackle it or make it cleaner and more efficient.

## Summary

**Yes — the prop-drilling problem is still fully present** in the live code, and the original notes in `change.md` describe it accurately. The `slot-cell-refactor` explicitly *deferred* this work (research group B) so nothing has changed it. Concretely, today:

- The cell wiring is **triple-declared verbatim** — `PlannerGrid` `Props` (`PlannerGrid.tsx:13-33`), the inline `PeriodRow` param type (`PlannerGrid.tsx:116-130`), and the `SlotCell` call site (`PlannerGrid.tsx:142-158`). `PeriodRow` is a **pure pass-through** that consumes none of these fields except to compute `dropHint`/`occupants` per cell.
- The whole `names: Record<string,string>` map is threaded board → grid → row → cell → `chipWiring` → chip, where each chip uses **exactly one entry** (`PlacedChip.tsx:55`). The same "whole record, one entry needed" shape also applies to `collisions` (`PlacedChip.tsx:56-58`).
- A second pass-through layer exists *below* the cell: `WeekLane` takes the whole `chipWiring` and re-spreads it onto each `PlacedChip` without reading a field (`WeekLane.tsx:9,20`).

**One important correction to the original `change.md` notes:** the notes call the 5 callbacks "stable" and propose bundling them as the *lower-risk* win. In the live code **4 of the 5 callbacks are NOT referentially stable** — `removePlacement`, `setWeek`, `toggleBundle`, `removeBundle` are re-created on every `PlannerBoard` render (the hooks return a fresh object each render), and `isOverridden` is a fresh closure too. Only `onInspect` (a `useState` setter) is stable. This matters: **bundling callbacks into a `handlers` object does NOT by itself make them stable**, and it does NOT unlock `React.memo(SlotCell)` / `React.memo(PlacedChip)` unless the callbacks (and the bundle object) are stabilized first. So the "cleaner" refactor and the "more efficient" refactor are **two separable goals** with different prerequisites.

There is **no efficiency emergency**: 50 cells, no measured perf problem, and the constraint engine (the <200ms budget) is entirely board-level `useMemo` work, untouched by the grid's prop shape. The case for change is **readability / maintainability** (kill the triple declaration, narrow each component's surface), with a *latent* perf upside that only pays off if memoization is added on top of stabilized inputs.

## Detailed Findings

### Validation — the problem as it exists today

**Triple-declared 14-field wiring.** The identical field set is written three times:
- Grid `Props` type — `PlannerGrid.tsx:13-33`
- `PeriodRow` inline param type — `PlannerGrid.tsx:116-130` (a verbatim copy minus `gridLabel`)
- `SlotCell` construction — `PlannerGrid.tsx:142-158`

`PeriodRow` (`PlannerGrid.tsx:102-163`) forwards everything and only adds per-cell derivation: `occupants = byCell.get(...)`, `dropHints?.get(...)`, `isBundled(...)`. It is a pure pass-through layer.

**`names` threaded whole to every cell, used one-entry-at-a-time.**
- Passed at `PlannerGrid.tsx:86` (→ row), `:132` (→ via byCell sort), `:148`-area (→ cell).
- `SlotCell` does **not** read `names` itself — it only forwards it into `chipWiring` (`SlotCell.tsx:89`).
- Each chip resolves only its own occupant: `const name = names[placement.courseId] ?? placement.courseId;` (`PlacedChip.tsx:55`).
- The `names[id] ?? id` fallback is duplicated across the grid sort (`PlannerGrid.tsx:177`), the chip (`PlacedChip.tsx:55`), and the dialog path.

**`collisions` has the same shape problem.** The whole `CellCollisions` for a cell is passed to each chip, which reads only its own id via `.blockingIds.has / .warningIds.has / .unavailableIds.has(placement.courseId)` (`PlacedChip.tsx:56-58`).

**A second pass-through below the cell.** `WeekLane` (`WeekLane.tsx:9`) accepts the whole `wiring` object and re-spreads it onto each `PlacedChip` (`WeekLane.tsx:20`) without consuming any field — a mirror of `PeriodRow` one layer down.

### Callback stability — the correction that reframes the options

Origins (all in `PlannerBoard.tsx`, destructured from the two state hooks):
- `onRemove` ← `removePlacement` (`use-placements.ts:81-83`) — **not stable**
- `onSetWeek` ← `setWeek` (`use-placements.ts:85-87`) — **not stable**
- `onToggleBundle` ← `toggleBundle` (`use-slot-bundles.ts:41-44`) — **not stable**
- `onRemoveBundle` ← `removeBundle` (`use-placements.ts:93-95`) — **not stable**
- `onInspect` ← `inspection.open` = a `useState` setter (`PlannerBoard.tsx:236-252`) — **stable** (React guarantee)
- `isOverridden` ← inline arrow recreated every render (`use-slot-bundles.ts:76`) — **not stable**

`usePlacements` / `useSlotBundles` declare these inline and return a **fresh object every render** (`use-placements.ts:303-317`, `use-slot-bundles.ts:74-83`). No `useCallback` exists anywhere in `plan-detail/`.

Memoized board-level inputs that *are* safe to pass through: `collisions` (`useCollisions`, `PlannerBoard.tsx:196`), `dropHints` (`useDragHints`, `:212`), `hintMode` / `names` (stable scalar / prop).

### Memoization state today

- **No `React.memo` anywhere in the codebase.** `SlotCell`, `PlacedChip`, `PeriodRow`, `WeekLane`, `WeekToggle` are all plain function components.
- The only grid-path `useMemo`s are board-level data derivations (`collisions`, `dropHints`, `hours`, `catalogById`, `availabilityIndex`) plus one merged-ref memo inside `useCellDnd` (`SlotCell.tsx:180`).
- `byCell` is recomputed every render (`PlannerGrid.tsx:54`).
- An explicit forward-coupling note already flags the prerequisite (`SlotCell.tsx:87-88`):
  > `// NOTE: this is a fresh object each render, so it would defeat a React.memo(PlacedChip) — stabilize it (e.g. useMemo in a named hook) before adding that memo, or the memo no-ops.`

### Scale / efficiency context

- Grid renders **days × periods = 5 × 10 = 50 `SlotCell` instances** (`PlannerGrid.tsx:35,52-53`).
- The `partitionByWeek` allocation per cell is already gated to the biweekly branch (~95% of cells skip it) — commit `a570192`.
- The <200ms placement/constraint budget lives entirely in board-level `model/` + `useMemo`; **the grid's prop shape does not touch that hot path.** Any perf gain from this refactor is render-cost only, currently unmeasured and likely negligible at 50 cells.

## Options to tackle it

Ordered from lowest-risk/cosmetic to highest-leverage. They compose; pick a stopping point.

### Option 0 — Extract a shared `CellWiring` type (kills the triple declaration)
- One `type CellWiring = { ... }` (or `Omit<Props, 'days'|'periods'|'gridLabel'|'placements'>`), referenced by both `PlannerGrid` `Props` and `PeriodRow`'s param. Removes the verbatim copy at `PlannerGrid.tsx:116-130`.
- **Risk:** trivial, type-only. **Payoff:** eliminates B3 entirely, no runtime change. Good "always do this regardless."

### Option A — Resolve `name` at grouping time (kills `names` threading)
- `groupByCell` (`PlannerGrid.tsx:170`) already has `names` and sorts by it. Attach the resolved `name` onto each occupant (or emit a `{ placement, name }` view-model) so `SlotCell` / `WeekLane` / `PlacedChip` never see the map and the `names[id] ?? id` fallback collapses to one site.
- Optionally do the same for `collisions` → per-occupant flags, removing the other whole-record prop.
- **Risk:** low–moderate (touches the occupant type flowing through cell/chip). **Payoff:** removes B2 and the duplicated fallback; narrows the chip's surface to genuinely per-chip data. This is the **cleanest single high-value step** and is independent of any context/memo decision.

### Option B — Bundle callbacks into a `CellHandlers` object
- Build one `handlers: CellHandlers` in `PlannerBoard` and pass it through. Shrinks the wiring from 5 callback props to 1.
- **Caveat (the correction):** purely cosmetic unless the callbacks are also stabilized. To make it *referentially* stable, wrap the bundle in `useMemo`/`useCallback` in `PlannerBoard` (or have `usePlacements`/`useSlotBundles` return stabilized handlers). On its own it does **not** enable memo.
- **Risk:** low. **Payoff:** readability; prerequisite for Option D.

### Option C — `PlannerGridContext` for the cross-cutting, stable values
- A small context provides `handlers` + `names` (or a `nameOf` resolver) + `hintMode` once at the grid root; `SlotCell`/`PlacedChip` read it via `useContext`. `PeriodRow` stops forwarding them entirely, shrinking its surface to `{ period, days, byCell, collisions, dropHints, isOverridden }`.
- **Tradeoffs:** Context is **not an established pattern** here — the only `createContext` in `src/` is the shadcn `form.tsx` wrapper (`shared/ui/form.tsx:28,66`). Introduces indirection; per-cell data (`occupants`, `collisions`, `dropHint`, `bundled`) must stay as props regardless. Context value must be memoized or it re-renders all consumers.
- **Risk:** moderate (new pattern in the slice). **Payoff:** highest readability — `PeriodRow` and the triple declaration largely dissolve. Best combined with Option A so the context carries only stable cross-cutting values and the cells get clean per-cell props.

### Option D — Add `React.memo` to `SlotCell` / `PlacedChip` (the "efficiency" lever)
- Only meaningful **after** inputs are stabilized: stable `handlers` (Option B + `useCallback`/`useMemo`), stable `chipWiring` (the `SlotCell.tsx:87-88` note), and stable per-cell objects. Then a single placement change re-renders ~1 cell instead of 50.
- **Risk:** moderate; easy to get wrong (a single unstable prop silently no-ops the memo). **Payoff:** render efficiency — but **unmeasured benefit at 50 cells**; treat as optional and justify with a profile, not by default.

### Recommended shape
**Option 0 + Option A** give almost all the cleanliness win at low risk and are independent of the contentious choices. Layer **Option B (stabilized)** and **Option C** if you want `PeriodRow` to disappear. Hold **Option D** behind an actual render-cost measurement — the constraint budget is unaffected, so don't pay memo complexity without a profile.

## Code References

- `src/_pages/plan-detail/ui/PlannerGrid.tsx:13-33` — Grid `Props`: the 14-field surface (declaration 1)
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:102-130` — `PeriodRow` pure pass-through + verbatim inline type (declaration 2)
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:142-158` — `SlotCell` construction (declaration 3)
- `src/_pages/plan-detail/ui/PlannerGrid.tsx:170-179` — `groupByCell` / `compareByName` already hold `names` (Option A hook point)
- `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:87-89` — `chipWiring` fresh-object + memo coupling note
- `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx:55-58` — chip uses one `names` entry + one `collisions` id
- `src/_pages/plan-detail/ui/slot-cell/WeekLane.tsx:9,20` — second pass-through layer (re-spreads `wiring`)
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:147-161` — where all grid props originate
- `src/_pages/plan-detail/model/use-placements.ts:81-95,303-317` — callbacks declared inline, fresh object per render (not stable)
- `src/_pages/plan-detail/model/use-slot-bundles.ts:41-44,74-83` — `toggleBundle`/`isOverridden` not stable
- `src/shared/ui/form.tsx:28,66` — the only existing `createContext` in `src/` (precedent for Option C)

## Architecture Insights

- The slice already favors **flat handler objects returned from hooks** (`UsePlacements`, `UseSlotBundles`) — bundling cell callbacks into a `CellHandlers` type is idiomatic with that grain (Option B), but the hooks don't yet stabilize their return identity.
- The grid's prop surface grew **additively** over many changes (`slot-as-a-group` added `overrides`/bundle handlers; `bi-weekly` added week toggles) — each extended the pass-through rather than collapsing it. The triple declaration is the accumulated cost of that pattern.
- Two distinct concerns are entangled under "prop drilling": **(a) shape/readability** (triple type, whole-record props, pass-through layers) and **(b) render efficiency** (no memo, unstable callbacks). The original notes conflated them by calling the callbacks "stable." They are separable and have different risk profiles — (a) is safe and high-value, (b) is optional and needs measurement.
- Context is essentially greenfield in this codebase; introducing it is a real (if small) convention decision, not a free refactor.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-slot-cell-refactor/plan.md:45` — **explicitly deferred** this exact work: "PlannerGrid prop-drilling cleanup (research group B) … a separate prop-architecture concern. PlannerGrid is touched here only to add grid roles … no other prop restructuring." The only sanctioned prop change was the new `gridLabel`.
- `context/archive/2026-06-22-slot-cell-refactor/research.md:59-61` — original B1/B2/B3 analysis (source of the `change.md` notes), including the `CellHandlers` vs `PlannerGridContext` framing.
- Commit `a570192` (`gate partitionByWeek + memo coupling note`) — gated the per-cell allocation and added the `SlotCell.tsx:87-88` forward note about stabilizing `chipWiring` before any `PlacedChip` memo.
- `context/archive/2026-06-13-slot-as-a-group` / `2026-06-12-group-dragging` / `2026-06-21-bi-weekly-week-aware-validation` — all **extended** the grid's pass-through surface; none attempted to collapse it. Confirms this is unaddressed accumulated debt, not a solved-then-regressed issue.

## Related Research

- `context/archive/2026-06-22-slot-cell-refactor/research.md` — parent research; section B is the seed for this change.
- `context/changes/planner-prop-drilling/change.md` — the notes this research validates and corrects.

## Open Questions

1. **Is there a measurable render cost?** Option D's value is unproven at 50 cells. Worth a quick React Profiler capture during a drag before committing to memoization.
2. **Should callback stabilization live in the hooks or the board?** Stabilizing `usePlacements`/`useSlotBundles` return identity benefits any consumer (Option B/D prerequisite) but is a wider change than wrapping at the board.
3. **Context vs. resolved view-model.** If Option A (resolve `name`/flags at grouping time) lands, how much does a `PlannerGridContext` still buy versus just passing a small stabilized `handlers` object? The context may only be worth it to delete `PeriodRow`.
4. **Scope boundary:** keep this change grid-internal, or also stabilize the model hooks (touches `use-placements.ts` / `use-slot-bundles.ts`)? That decision sets the blast radius.
