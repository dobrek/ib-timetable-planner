# PlannerGrid Prop Drilling — Resolve-at-Grouping + Shared Wiring Type

## Overview

A behavior-preserving refactor of the planner grid's prop surface. Today the grid threads a whole `names: Record<string,string>` map and a whole `CellCollisions` record down through `PeriodRow → SlotCell → WeekLane → PlacedChip`, even though each chip uses exactly one name entry and three membership checks. We resolve each occupant's display name + collision flags **once, at grouping time**, into a per-cell view-model (`CellOccupant`), so the cell/chip components receive only genuinely per-occupant data (**Option A**). We then extract a shared `CellWiring` type so the cell wiring is declared once instead of three times verbatim (**Option 0**).

No data-model, API, action, or user-visible behavior change. This is a structural/readability refactor; the constraint engine and its <200ms budget are untouched.

## Current State Analysis

- `PlannerGrid.tsx` already owns `groupByCell(placements, names)` (`PlannerGrid.tsx:170-179`), which groups occupants per cell and sorts them by resolved name (`names[id] ?? id`) then `courseId`. This is the natural hook point for Option A — it already holds `names`.
- The 14-field cell wiring is declared **three times verbatim**: `PlannerGrid` `Props` (`PlannerGrid.tsx:13-33`), the inline `PeriodRow` param type (`:116-130`), and the `SlotCell` call site (`:142-158`). `PeriodRow` is a pure pass-through.
- `PlacedChip` consumes one `names` entry (`PlacedChip.tsx:55`) and three `collisions` membership checks (`PlacedChip.tsx:56-58`). `SlotCell` reads `collisions` only for cell-level tone (`SlotCell.tsx:72-73`).
- `CellCollisions` is derived from the cell's own occupants (`collisions.ts:42-70`), so `cell.hasBlocking ≡ occupants.some(o => o.blocking)` is an exact equivalence — `SlotCell` can drop the `CellCollisions` prop entirely and derive tone from per-occupant flags.
- `WeekLane` (`WeekLane.tsx:9,20`) is a second pure pass-through: it re-spreads the whole `wiring` onto each chip.
- `hasBiweekly` / `partitionByWeek` (`week.ts:25,33`) are generic over `{ week }` and called **only** in `SlotCell` (`SlotCell.tsx:79,82`). They currently receive `LocalPlacement[]` (top-level `.week`); with the chosen nested view-model the week lives at `.placement.week`.

## Desired End State

`SlotCell`, `WeekLane`, and `PlacedChip` receive `CellOccupant[]` (or a single `CellOccupant`) — never the `names` map or a `CellCollisions` record. The per-occupant name and `blocking/warning/unavailable` flags are resolved once in a tested pure function in `model/`. The cell wiring shared by `PlannerGrid` and `PeriodRow` is declared exactly once via a `CellWiring` type. All existing tests, e2e, type-check, lint, steiger, and build stay green; the UI behaves identically.

### Key Discoveries:

- `groupByCell` already holds `names` — fold flag resolution in beside name resolution (`PlannerGrid.tsx:170-179`).
- Cell tone is derivable from occupant flags — exact equivalence (`collisions.ts:42-70`).
- Week helpers are generic and sole-caller'd by `SlotCell` (`week.ts:25,33`, `SlotCell.tsx:79,82`) — safe to generalize with a `weekOf` accessor with no other fallout.
- `groupByCell` / `compareByName` are module-local (not exported) — moving them out of `PlannerGrid.tsx` affects nothing else.

## What We're NOT Doing

- **Not** bundling the callbacks into a `CellHandlers` object (Option B), introducing a `PlannerGridContext` (Option C), or adding `React.memo` (Option D). The callbacks are not referentially stable; memoization is deferred until a measured render-cost case exists.
- **Not** stabilizing the model hooks (`use-placements.ts`, `use-slot-bundles.ts`) or touching `PlannerBoard`'s prop origins.
- **Not** touching the four board-level siblings that also receive `names` (`PlannerPalette`, `ErrorBanner`, `CollisionDetailsDialog`, `GroupDragOverlay`) — they are outside the grid.
- **Not** changing any drag-drop, collision, week-lane, or bundle behavior. Pure refactor.

## Implementation Approach

Nested-composition view-model: `type CellOccupant = { placement: LocalPlacement; name: string; blocking: boolean; warning: boolean; unavailable: boolean }`, built fresh (never mutating `LocalPlacement`), keeping identity tokens (`placement`) separate from resolved display per the "identity as opaque tokens" lesson. A new `model/cell-occupants.ts` owns the type and `groupCellOccupants(placements, names, collisions)`, replacing the in-component `groupByCell`/`compareByName`. The week helpers gain a required `weekOf` selector so the nested shape works with one implementation (no duplication, no dead code). The grid then consumes `names`+`collisions` once at the top and threads only `CellOccupant[]` + per-cell scalars + handlers downward. Finally a local `CellWiring` type collapses the `PlannerGrid`/`PeriodRow` duplication.

## Phase 1: Resolve-at-grouping view-model + shared wiring type

### Overview

Introduce the `CellOccupant` view-model and the pure resolver, generalize the week helpers, rewire the grid/cell/chip components onto the view-model (dropping `names` and `CellCollisions` from the cell/chip surface), and extract the shared `CellWiring` type.

### Changes Required:

#### 1. New view-model + resolver

**File**: `src/_pages/plan-detail/model/cell-occupants.ts` (new)

**Intent**: Own the per-cell occupant view-model and its construction, so name + collision-flag resolution happens once instead of inside every chip. Replaces the in-component `groupByCell`/`compareByName`.

**Contract**:
- `export type CellOccupant = { placement: LocalPlacement; name: string; blocking: boolean; warning: boolean; unavailable: boolean }`.
- `export const groupCellOccupants = (placements: LocalPlacement[], names: Record<string,string>, collisions: Map<string, CellCollisions>): Map<string, CellOccupant[]>` — group by `cellKey`, resolve `name = names[courseId] ?? courseId` and `blocking/warning/unavailable` from the cell's `CellCollisions` (`.blockingIds/.warningIds/.unavailableIds.has(courseId)`, defaulting `false` when the cell has no collisions), and sort each cell's occupants by `name` then `courseId` (preserving today's order). Private `compareByName` helper retained.

#### 2. Generalize the week helpers

**File**: `src/_pages/plan-detail/model/week.ts`

**Intent**: Let `hasBiweekly`/`partitionByWeek` operate on the nested view-model without duplicating their logic, by taking a week selector instead of requiring a top-level `week` field.

**Contract**: `hasBiweekly<T>(occupants: T[], weekOf: (o: T) => PlacementWeek)` and `partitionByWeek<T>(occupants: T[], weekOf: (o: T) => PlacementWeek)`. Selector is required; the sole caller (`SlotCell`) is updated in change #4. Update **both** affected groups in `week.test.ts` — `hasBiweekly` (`:44-49`) and `partitionByWeek` (`:53-77`) — to pass `(o) => o.week`, so neither trips `pnpm test`.

#### 3. Grid consumes name/collisions once; threads view-model down

**File**: `src/_pages/plan-detail/ui/PlannerGrid.tsx`

**Intent**: Resolve occupants once at the top via `groupCellOccupants`, stop threading `names`/`collisions` map below the grid, and collapse the triple-declared wiring into a single `CellWiring` type (Option 0).

**Contract**:
- Replace local `groupByCell`/`compareByName` with a call to `groupCellOccupants(placements, names, collisions)`; remove the moved helpers from this file.
- Define `type CellWiring = { dropHints: Map<string, DropHint> | null; hintMode: HintMode; isOverridden: (day, period) => boolean; onRemove; onSetWeek; onToggleBundle; onRemoveBundle; onInspect }`. `Props = CellWiring & { days; periods; gridLabel; placements; names; collisions }`. `PeriodRow` params = `CellWiring & { period; days; byCell: Map<string, CellOccupant[]> }`.
- `PeriodRow` no longer forwards `names` or a per-cell `CellCollisions` to `SlotCell`; it passes `occupants: CellOccupant[]`, the resolved `dropHint`/`hintActive`, `hintMode`, and `bundled`.

#### 4. SlotCell consumes view-model; derives tone from flags

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`

**Intent**: Drop the `names` and `collisions` props; take `occupants: CellOccupant[]`; derive cell tone and week lanes from the view-model.

**Contract**:
- Props lose `names` and `collisions`; `occupants` becomes `CellOccupant[]`.
- `hasBlocking = occupants.some(o => o.blocking)`, `hasWarning = occupants.some(o => o.warning)` (replaces the `collisions?.…size` reads).
- `biweekly = hasBiweekly(occupants, o => o.placement.week)`; `byWeek = biweekly ? partitionByWeek(occupants, o => o.placement.week) : null`.
- `chipWiring: ChipWiring = { day, period, bundled, onRemove, onSetWeek, onInspect }` (drops `names`, `collisions`). Update the fresh-object memo note to reflect the smaller shape.
- `<PlacedChip>` and `<WeekLane>` now receive `CellOccupant`s (see #5, #6).

#### 5. PlacedChip reads resolved fields

**File**: `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx`

**Intent**: Consume the pre-resolved name/flags from a `CellOccupant` instead of resolving from a `names` map + `CellCollisions`.

**Contract**: `ChipWiring` loses `names` and `collisions` → `{ day; period; bundled; onRemove; onSetWeek; onInspect }`. The component takes `ChipWiring & { occupant: CellOccupant }`. Field reads repoint: `occupant.name`, `occupant.blocking/.warning/.unavailable`, and `occupant.placement.id/.courseId/.week/.pending` (e.g. `onInspect({ day, period, courseId: occupant.placement.courseId })`, `useDraggable` id/data from `occupant.placement`).

#### 6. WeekLane forwards view-model occupants

**File**: `src/_pages/plan-detail/ui/slot-cell/WeekLane.tsx`

**Intent**: Carry `CellOccupant[]` and the slimmer `ChipWiring`.

**Contract**: `chips: CellOccupant[]`; render `<PlacedChip key={c.placement.id} occupant={c} {...wiring} />`.

#### 7. Resolver unit test

**File**: `src/_pages/plan-detail/model/cell-occupants.test.ts` (new)

**Intent**: Guard the moved pure logic at the right altitude.

**Contract**: Assert sort determinism (by name then `courseId`), the `name ?? courseId` fallback for an id absent from `names`, flag mapping from `CellCollisions` (including a single-occupant `unavailable`), and an empty/collision-free cell yielding all-`false` flags.

### Success Criteria:

#### Automated Verification:

- Type-check passes: `pnpm check`
- Unit tests pass (incl. new `cell-occupants.test.ts` and updated `week.test.ts`): `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Chips render the correct course names (not ids); collision and teacher-unavailable badges appear on the same chips as before and open the details dialog for the right course (confirms the `courseId` threaded into `onInspect`).
- Cell destructive/amber outlines and the per-chip blocking/warning tones are unchanged.
- Week A/B lanes, the agnostic-above-lanes layout, drag-drop (single + bundle), and group/ungroup/bulk-remove all behave identically.
- No regression in the palette, error banner, collision dialog, or group drag overlay (untouched siblings).

**Implementation Note**: After automated verification passes, pause for manual confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- `cell-occupants.test.ts`: sort order, name fallback, flag mapping (incl. single-occupant unavailable), empty/clean cell.
- `week.test.ts`: updated to the `weekOf`-selector signature in both the `hasBiweekly` and `partitionByWeek` groups; existing cases preserved.

### Integration / E2E Tests:

- No new tests. **The planner grid has no e2e or DOM coverage** — the e2e suite covers auth + the course-catalog table, not the grid, and there is no Testing Library/jsdom in the toolchain. Behavior preservation therefore rests on `pnpm check`, the new `cell-occupants.test.ts` resolver test, and the manual pass below. Note `pnpm check` guards the resolver and any *type-changing* repoint, but NOT a same-typed field swap (`occupant.placement.id` ↔ `.courseId`, or rendering `.courseId` instead of the resolved `name` — all `string`); the manual steps are the only guard for that class, so run them deliberately.

### Manual Testing Steps:

1. Open a plan with collisions and a teacher-unavailable placement — confirm chip labels are course **names** (not ids), badges land on the right chips, and clicking a badge opens the dialog **for the right course** (verifies the `courseId` carried into `onInspect`).
2. Place a bi-weekly course — confirm A/B lanes and the agnostic-above-lanes layout.
3. Drag a single chip and a bundled slot — confirm both still move; group/ungroup/bulk-remove still work.

## Performance Considerations

Neutral. Resolution moves from per-chip (inside render) to once-per-cell at grouping; total work is equivalent at 50 cells. The constraint engine and its <200ms budget are untouched. Memoization is explicitly deferred (Option D) pending a measured case.

## Migration Notes

None — no schema, data, or API change.

## References

- Research: `context/changes/planner-prop-drilling/research.md`
- Notes (B1/B2/B3): `context/changes/planner-prop-drilling/change.md`
- Prior deferral: `context/archive/2026-06-22-slot-cell-refactor/plan.md:45`
- Hook point: `src/_pages/plan-detail/ui/PlannerGrid.tsx:170-179`
- Flag source: `src/_pages/plan-detail/model/collisions.ts:42-70`
- Lesson — identity as opaque tokens, display at the edges: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Resolve-at-grouping view-model + shared wiring type

#### Automated

- [ ] 1.1 Type-check passes: `pnpm check`
- [ ] 1.2 Unit tests pass (incl. new `cell-occupants.test.ts` and updated `week.test.ts`): `pnpm test`
- [ ] 1.3 Linting passes: `pnpm lint`
- [ ] 1.4 FSD structure passes: `pnpm steiger`
- [ ] 1.5 Production build is clean: `pnpm build`

#### Manual

- [ ] 1.6 Chips render correct names (not ids); collision/unavailable badges on the right chips, open the dialog for the right course
- [ ] 1.7 Cell outlines and per-chip blocking/warning tones unchanged
- [ ] 1.8 Week A/B lanes, drag-drop (single + bundle), group/ungroup/bulk-remove behave identically
- [ ] 1.9 No regression in palette, error banner, collision dialog, group drag overlay
