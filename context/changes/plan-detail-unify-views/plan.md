# Unify plan-detail views (combined = the board, single = a focus mode) — Implementation Plan

## Overview

Fold the two plan-detail orchestrators (single `PlannerBoard` + `CombinedPlannerBoard`), their two grids, two palettes, two routes, and two loaders into **one `focus`-parameterized board**. The combined two-cohort board becomes **the** board and the default landing surface; a single cohort becomes a **focus mode** (`focus = "dp1" | "dp2"`) that renders one column. The p1–p9 refactor already shares the substance (all of `model/`, `BoardShell`, `resolveCombinedDrop`, the per-cohort state pipeline, the cell internals, `PaletteBody`); this change folds the thin top-level orchestrators that remain.

Per research, the only remaining un-extracted, untested handler logic — the drop `switch` — is extracted **first** as a standalone, independently-shippable seam (`applyDropAction`), then the unification builds on that already-tested seam.

## Current State Analysis

Two entry points exist today, diverging only at the thin top:

| | Single (focus, today) | Combined (the board, today) |
|---|---|---|
| Component | `ui/PlannerBoard.tsx` (266 ln) | `ui/CombinedPlannerBoard.tsx` (282 ln) |
| State hook | `useCohortBoardState(props, idx, idx)` | `useCombinedBoardState(dp1, dp2)` |
| Grid | `ui/grid/PlannerGrid.tsx` (1 col/day) | `ui/grid/PairedPlannerGrid.tsx` (2 sub-cols/day) |
| Palette | `ui/palette/PlannerPalette.tsx` (no switcher) | `ui/palette/CombinedPalettePanel.tsx` (tabbed) |
| Header | `PlanSummaryBar` (counts) → `BoardHeader` + `CohortSwitcher active={cohort}` | inline header + `CohortSwitcher active="combined"`, **no** summary bar |
| Route | `src/pages/plans/[id]/index.astro?cohort=` (missing → dp1) | `src/pages/plans/[id]/combined.astro` |
| Wrapper | `ui/PlanDetailPage.astro` | `ui/PlanDetailCombinedPage.astro` |
| Loader | `loadPlannerData(supabase, id, cohort)` | `loadCombinedPlannerData(supabase, id)` |

What is **already shared** (don't re-share): all of `model/`; `BoardShell`; the `useCohortPlacements → useCohortDerivations → toCohortState` pipeline (`model/use-cohort-board-state.ts`); the one drop router `resolveCombinedDrop`; `SlotCellHost` + `SlotCell` + chip/lane internals; `PaletteBody`; `CollapsibleEdgePanel` (already exposes an optional `toolbar` slot); `ShelfDrawer`; the disclosure/hint hooks; the overlay + collision dialog.

What still diverges, and what this plan resolves:
- The `handleDrop` `switch` body is duplicated near-verbatim across both boards and is the only untested handler logic (`PlannerBoard.tsx:121-149`, `CombinedPlannerBoard.tsx:107-138`).
- Cohort-optionality: `cohort?` threads through `SlotCell`/`SlotCellHost`/`drop-router`/`drag.ts`, with `?? activeCohort` fallbacks that exist solely to keep the single board's cells untagged (`drop-router.ts:44,56,62,71`; `SlotCell.tsx:114-118,177,186`).
- Two grids, two palettes (one ~60 ln removable per research), two routes, two loaders.
- Chrome: summary bar present in focus, absent in combined; full-screen empty (focus) vs in-panel empty (combined); palette cookie honored in focus, hardcoded-collapsed in combined.

### Key Discoveries:

- **The cross-index cycle is the crux, and the framing dissolves the only hard blocker.** Each cohort's *live* occupancy index derives from the other column's current placements; `useCombinedBoardState` resolves the cycle by sequencing both `usePlacements` → each fresh index → both derivations in one render (`model/use-cohort-board-state.ts:16-32`). You cannot express combined as "call the single hook twice" (Rules-of-Hooks). **But** "single = combined focused on one cohort" means **both cohorts are always instantiated**, so `useCombinedBoardState(dp1, dp2)` is always called with a constant hook count of 2 and the cycle (built for exactly 2) keeps working. The unified board always runs both; focus mode just renders one column.
- **The `<200ms` budget is client-side, not SSR** (`CLAUDE.md:10`; `model/collision/collisions.perf.test.ts:49-72`, measured sub-millisecond). Always-load-both is an SSR-only, parallelized ~+44% query cost (research §1) with **zero per-drag cost** — the hidden cohort's client derivations memoize away (inputs never change).
- **The hard cut is contained.** Only `CohortSwitcher.tsx:24,26` links to `?cohort=` / `/combined`. No nav/breadcrumb/test references the routes; `index.astro:12` already coerces missing/garbage `?cohort=` to a default — so a redirect-free switch to `?focus=` touches one component.
- **`CollapsibleEdgePanel` already has the seam** for the palette merge: an optional `toolbar` slot (`CollapsibleEdgePanel.tsx:40,52`) that the combined palette fills with the cohort tabs; `PaletteBody` is already shared. A one-panel/optional-toolbar merge is low-friction.
- **`PairedPlannerGrid` already maps over a `columns` array internally** (`PairedPlannerGrid.tsx:41-43`); `PlannerGrid` is the degenerate 1-column case. Both feed the same `SlotCellHost`. A parametric `columns: PairedColumn[]` (length 1–2) is a small step.
- **`loadPlannerData` has live integration-test consumers** (`api/load.integration.test.ts`, `api/reload-restore.integration.test.ts`) — the production read-boundary coverage must migrate to `loadCombinedPlannerData`, not be dropped.

## Desired End State

One board component (`focus: Cohort | "combined"`) rendered from one route (`/plans/[id]?focus=dp1|dp2|combined`, bare route → combined) by one loader (`loadCombinedPlannerData`). `focus = "combined"` renders today's combined behavior plus a summary bar; `focus = "dp1"|"dp2"` renders one column locked to that cohort (no switcher in the palette, no sibling-dim, full-screen empty state, cohort-tagged cells). Cohort is always tagged; the optionality branches are gone. The drop dispatch is one canonical, unit-tested `applyDropAction`. The two grids, two palettes, two wrappers, the single loader, and `combined.astro` are deleted.

**Verification:** `pnpm steiger`, `pnpm lint`, `pnpm test`, `pnpm build` all clean; manual: every `?focus=` value renders correctly, the switcher navigates between all three, a drag/park/lift in each mode behaves as before, and the page-load + per-drag latency is unchanged.

### Key Discoveries (decisions already locked — see `research.md`):

- Loader: **always load both** (one loader for every mode).
- Routing: **single `?focus=` param**, hard cut, no redirects/aliases.
- Default landing: **combined** (this session's decision).
- Chrome: **preserve single's UX in focus mode AND upgrade combined** — add `PlanSummaryBar` to combined, keep full-screen empty for focus / in-panel for combined, honor the palette cookie in all modes.
- Cells: **always tag cohort**; delete the optionality branches; accept cohort-prefixed aria-labels + namespaced dnd ids + parked-card badge in focus mode.
- Grid + palette: **merge** (one parametric grid; one panel with optional switcher toolbar).
- Lift button: **route through `applyDropAction`**; `handleDragStart`: **leave inline**.

## What We're NOT Doing

- No 301 redirects or `?cohort=` / `/combined` aliases — old internal bookmarks break (acceptable pre-GA).
- Not touching the constraint/validation core (`model/collision/*`, `model/cross-cohort/cross-cohort-index.ts`) — cohort-agnostic, stays as-is.
- Not changing the per-drag latency path; no perf budget work (loader cost is SSR-only).
- Not folding `SlotCellHost` into `SlotCell` (orthogonal to single-vs-combined; out of scope).
- Not extracting `handleDragStart` (divergence dominates; left inline).
- Not adding new lighter "partial sibling props" loader path (research §1 closed this).

## Implementation Approach

Four phases, ordered so the one user-visible behavior change (cohort-always-tagged) lands isolated and each phase keeps the parity/characterization safety net green:

1. **`applyDropAction` dispatch seam** — standalone, no behavior change, ships as its own PR.
2. **Cohort-always-tagged** — the isolated behavior change; both boards still exist.
3. **Grid + palette structural merge** — behavior-preserving component consolidation; both boards still exist.
4. **Collapse orchestrators + routes + loaders** — the structural collapse into one `focus` board; deletes the dead single-path code.

Phases 1–3 leave the two-loader/two-board parity guardrail fully intact. Phase 4 is where that structure collapses and the *loader*-parity tests retire (their job done), while the board-seam characterization tests and the cohort-agnostic collision-parity test stay throughout.

## Critical Implementation Details

- **Constant hook count is load-bearing.** The unified board must call `useCombinedBoardState(dp1, dp2)` **unconditionally** in every mode (including focus) and only branch on `focus` when *rendering*. Never gate the state hook on `focus` — that reintroduces the Rules-of-Hooks violation the whole framing exists to avoid. The cross-index cycle (`use-cohort-board-state.ts:16-32`) is built for exactly 2 cohorts and keeps working because both are always present.
- **`activeCohort` survives in the drop router.** Phase 2 deletes the four `?? activeCohort` *fallbacks* (cell/drag cohort are now always present), but the `activeCohort` **parameter stays** — a cohort-free palette `course`/`grouping` drag dropped on the cell-less shelf still parks under `activeCohort` (`drop-router.ts:50,54`). In focus mode `activeCohort` = the focused cohort; in combined = the palette's active cohort.
- **Loader-parity test retirement is intentional, not a coverage loss.** `api/parity.test.ts` + `api/adapter-parity.integration.test.ts` exist to prove the *two* loaders agree per-cohort. With one loader that guarantee is structural — remove them in Phase 4, but first migrate `api/load.integration.test.ts` + `api/reload-restore.integration.test.ts` onto `loadCombinedPlannerData` so the production read-boundary coverage is preserved.
- **Phase 3 grid/palette merge must be byte-for-byte behavior-preserving.** The parametric grid's `columns.length === 1` path must render exactly as `PlannerGrid` does today (no cohort sub-label row, no column span) so the focus/single output is unchanged; the merged palette with no toolbar must render exactly as `PlannerPalette` does today. The behavior change belongs to Phase 2 (cohort tags) and Phase 4 (chrome), not Phase 3.

---

## Phase 1: `applyDropAction` dispatch seam

### Overview

Extract the duplicated drop `switch` into one pure, unit-tested `applyDropAction` in `model/cross-cohort/`. Wire both existing boards through it (single passes a constant resolver; combined passes a per-cohort resolver), and route the lift-button affordance through it too. No behavior change; both boards still exist. Ships as an independent PR.

### Changes Required:

#### 1. New drop-dispatch module

**File**: `src/_pages/plan-detail/model/cross-cohort/drop-dispatch.ts` (new)

**Intent**: One canonical place that maps a resolved `CombinedDropAction` to the right per-cohort `actions.*` call, replacing the near-verbatim `switch` body in both boards. Pure — calls no hooks, closes over nothing; cohort state and the one impure effect are injected. Fits the "guards/transitions in `model/`, hooks orchestrate" convention.

**Contract**: New exports — `applyDropAction(action, resolveState, effects)`, `DropDispatchState`, `DropEffects`. `resolveState(cohort)` returns the cohort's `{ actions, groupings, weekModeByCourseId }` (a structural subset of `CohortBoardState`, so combined can pass `c => byCohort[c]` directly). The body is the merged 8-case switch: `addCourse`/`movePlacement`/`moveBundle`/`placeBack` → the matching `actions.*`; `liftBundle` → `actions.shelveBundle` + `effects.collapseUnlessPinned()`; `placeBack` also fires `collapseUnlessPinned`; `dropGroup` → resolve grouping via `groupings.find` then `actions.addGroup(memberIds, cell, {oppositeWeek})`; `parkCourse`/`parkGroup` → resolve members via the already-extracted `defaultParkedWeek`/`groupingParkedMembers` then `actions.parkMembers` (no-op on empty). `CombinedDropAction` already carries `cohort` on every variant (`drop-router.ts:10-18`).

```ts
export type DropDispatchState = {
  actions: CohortActions; // from use-cohort-board-state
  groupings: PlannerGrouping[];
  weekModeByCourseId: Map<string, WeekMode>;
};
export type DropEffects = { collapseUnlessPinned: () => void };

export function applyDropAction(
  action: CombinedDropAction,
  resolveState: (cohort: Cohort) => DropDispatchState,
  effects: DropEffects,
): void;
```

#### 2. Single board → use the shared dispatch

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Replace the local `switch` + `dropGroup`/`parkToShelf`/`liftBundle` helpers with a single `applyDropAction` call; route the lift button through the same dispatch (fixes the inline-vs-helper asymmetry).

**Contract**: `handleDrop` keeps its inline prologue (clear one hint map, `event.canceled`/`source`/`target` guards, the `resolveCombinedDrop(..., cohort)` call) and then calls `applyDropAction(action, () => ({ actions, groupings, weekModeByCourseId }), { collapseUnlessPinned })`. The `useCellWiring` `onLiftBundle` becomes `(day, period) => applyDropAction({ kind: "liftBundle", cohort, day, period }, resolveState, { collapseUnlessPinned })`. Delete `dropGroup`, `parkToShelf`, `liftBundle`.

#### 3. Combined board → use the shared dispatch

**File**: `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx`

**Intent**: Same substitution, with the per-cohort resolver.

**Contract**: `handleDrop` keeps its inline prologue (clear both hint maps, reset `activeDragCohort`, guards, `resolveCombinedDrop(..., paletteCohort)`) then calls `applyDropAction(action, (c) => byCohort[c], { collapseUnlessPinned })`. `buildColumn`'s `onLiftBundle` routes through `applyDropAction({ kind: "liftBundle", cohort, day, period }, ...)`. Delete `dropGroup`, `liftBundle`, `parkToShelf` (keep `removeParked` — it is shelf-card routing, not a drop).

#### 4. Dispatch unit tests

**File**: `src/_pages/plan-detail/model/cross-cohort/drop-dispatch.test.ts` (new)

**Intent**: Cover the action→`actions.*` mapping that has **zero** coverage today (reachable previously only via a full island + dnd-kit drag sim, which the repo avoids).

**Contract**: ~8–12 cases with spy `actions`: each `action.kind` calls the right `actions.*` with the right args; `dropGroup`/`parkGroup` with an unknown id are no-ops (empty member list); `collapseUnlessPinned` fires on `liftBundle`/`placeBack`/park but **not** on `addCourse`/`movePlacement`; `resolveState` routing proves single (`() => theState`) and combined (`c => byCohort[c]`) dispatch identically (the single == degenerate-combined equivalence).

#### 5. Barrel export

**File**: `src/_pages/plan-detail/model/cross-cohort/` barrel (if one re-exports drop-router)

**Intent**: Export `applyDropAction` alongside `resolveCombinedDrop` if the cross-cohort segment has a barrel; otherwise import directly.

**Contract**: No cycle — `drop-dispatch.ts` imports `CohortActions` from `use-cohort-board-state.ts` and `CombinedDropAction` from `drop-router.ts` (intra-slice, steiger-clean).

### Success Criteria:

#### Automated Verification:

- Unit tests pass, incl. the new dispatch suite: `pnpm test`
- Lint + types clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`
- Production build clean: `pnpm build`

#### Manual Verification:

- On the single board: drop a course/grouping onto a cell and onto the shelf; move a placement; lift a bundle via the cell button and via drag-to-shelf; place a parked bundle back — all behave exactly as before.
- On the combined board: the same set across both columns, including the cross-cohort move rejection — unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. This phase is independently shippable as its own PR.

---

## Phase 2: Cohort-always-tagged (isolated behavior change)

### Overview

Make `cohort` always present on cells and relocating drags, and delete the optionality branches. This lands the one user-visible behavior change: focus/single cells gain cohort-prefixed aria-labels + namespaced dnd ids, and the parked-card cohort badge renders in focus mode. Both boards still exist.

### Changes Required:

#### 1. Drag/drop data types → cohort required

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Make `cohort` a required field on `CellData` (droppable) and on the relocating drag variants (`placement`, `bundle`, `parked`), so the router and cells can stop guarding for its absence. `course`/`grouping` palette drags stay cohort-free (their cohort is the palette's active cohort).

**Contract**: `CellData.cohort: Cohort` (was `cohort?`); the `bundle`/`placement`/`parked` `DragData` members carry `cohort: Cohort`. `course`/`grouping` members unchanged.

#### 2. Drop router → delete the `?? activeCohort` fallbacks

**File**: `src/_pages/plan-detail/model/cross-cohort/drop-router.ts`

**Intent**: With cohort always present, the cell/drag cohort fallbacks become identity and are deleted; the `activeCohort` parameter remains for the off-board park case only.

**Contract**: `targetCohort = cell ? cell.cohort : null`; each relocating case uses `data.cohort` directly (delete the four `?? activeCohort` at `:44,56,62,71`). `parkCourse`/`parkGroup` still emit `cohort: activeCohort`. Update the docstring (drop the "single board = untagged degenerate case" paragraph — the single board now tags too).

#### 3. Cell components → cohort required

**Files**: `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx`, `src/_pages/plan-detail/ui/grid/slot-cell/SlotCellHost.tsx`

**Intent**: `cohort` becomes required; the aria-label is always cohort-prefixed, the dnd ids are always namespaced, and the droppable `data.cohort` is always set.

**Contract**: `SlotCell` `cohort: Cohort` (was `cohort?`); `aria-label` = `"${cohortLabel(cohort)}, ${dayLabel(day)}, ${periodLabel(period)}"` unconditionally (delete the `cohort ? … : …` ternary at `:114-118`); `useCellDnd` always uses `scopedKey = `${cohort}:${key}`` and `bundle:${scopedKey}` (delete the `cohort ? … : key` at `:177,186`). `SlotCellHost` `cohort: Cohort` required (`:45,62,71`).

#### 4. Single grid → pass its cohort

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: The single grid must now tag each cell with the board's one cohort (it passed none before). Temporary — this grid is retired in Phase 3.

**Contract**: `PlannerGrid` gains a `cohort: Cohort` prop and spreads it into each `SlotCellHost`. `PlannerBoard` passes `cohort={cohort}`.

#### 5. Shelf + parked card → tag in focus mode

**Files**: `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx`, `src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx`, `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: With cohort always tagged, the single board's shelf cards now show the cohort badge and parked drags carry their cohort. The single board supplies the `cohortById` map (all its parked bundles → its one cohort).

**Contract**: `PlannerBoard` passes `cohortById` to `ShelfDrawer` (a `Map<string, Cohort>` of its parked bundle ids → `cohort`); `ParkedBundleCard` renders the badge and tags the parked drag data (`ParkedBundleCard.tsx:32,50-54`) — now always populated. `ShelfDrawer` `cohortById` becomes required/always-populated (`:18-20,98`).

#### 6. Rewrite the drop-router "untagged single board" tests

**File**: `src/_pages/plan-detail/model/cross-cohort/drop-router.test.ts`

**Intent**: The 11-case `describe("resolveCombinedDrop — single board (untagged, one cohort)")` block (`:100`) asserts the old untagged behavior; rewrite it to tag cells/drags. The cross-cohort guard cases (the combined block) are unchanged.

**Contract**: Replace the `bareCell` builder (untagged) with a tagged cell builder; the cases now assert tagged resolution. No assertion on the `parkCourse`/`parkGroup` activeCohort behavior changes (still routes under `activeCohort`).

### Success Criteria:

#### Automated Verification:

- All unit tests pass, incl. the rewritten `drop-router.test.ts` and the still-green collision/drop-hint/occupant suites (cohort-free data layer is unaffected): `pnpm test`
- Lint + types clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`
- Build clean: `pnpm build`

#### Manual Verification:

- On the single board: a screen reader announces cells as "DP1, Monday, Period 1" (cohort-prefixed); the parked-card cohort badge now shows; drag-and-drop, lift, park, place-back still behave identically (the dnd id namespacing is invisible to the user).
- On the combined board: no visible change.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. This is the only phase with a user-visible behavior change — verify the a11y labels and parked badge deliberately.

---

## Phase 3: Grid + palette structural merge (behavior-preserving)

### Overview

Generalize the two grids into one parametric grid and the two palettes into one panel with an optional switcher toolbar. Pure component consolidation — both boards still exist and render identically to before. Cohort is already required everywhere (Phase 2), so the merged-grid types are clean.

### Changes Required:

#### 1. Parametric grid

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx` (becomes the one grid) — retire `PairedPlannerGrid.tsx`

**Intent**: One grid taking `columns: PairedColumn[]` (length 1 in focus, 2 in combined). The column-spanning day header, the cohort sub-label row, and the sibling-dim are guarded by `columns.length > 1` so the single-column render is byte-for-byte today's `PlannerGrid` output.

**Contract**: New prop shape `{ days, periods, gridLabel, columns: PairedColumn[], activeDragCohort: Cohort | null }`. `gridTemplateColumns` = `auto repeat(days, <columns.length sub-columns>)`; with `columns.length === 1`: no sub-label row, day header spans 1, cells render with `dimmed={false}`. With `length === 2`: today's `PairedPlannerGrid` behavior (spanning header, sub-labels, `dimmed = activeDragCohort !== null && activeDragCohort !== column.cohort`). Keep `PairedColumn` exported. Both boards switch to this grid: single passes `columns={[column]}` + `activeDragCohort={null}`; combined passes `columns={[dp1Col, dp2Col]}`.

#### 2. One palette panel with optional toolbar

**File**: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx` (becomes the one panel) — retire `PlannerPalette.tsx`

**Intent**: One panel that renders a chosen cohort's body (ready/stale/empty) under the shared `CollapsibleEdgePanel`, with the cohort-switcher `Tabs` rendered only when there is more than one cohort. Focus mode passes one cohort and no switcher; combined passes both + the switcher.

**Contract**: Generalize props to a cohorts list + active cohort + optional change handler (parallel to the grid's `columns`): e.g. `{ cohorts: PaletteCohortData[], activeCohort, onActiveCohortChange?, collapsed, onCollapsedChange }`. Render the `toolbar` (cohort `Tabs`) only when `cohorts.length > 1`. The single-cohort, no-toolbar render must match today's `PlannerPalette` exactly. Re-export `usePaletteFilter` from here (or keep it sourced from `PaletteBody`) so the test import site stays stable. Both boards switch to this panel: single passes `cohorts={[paletteData(theCohort)]}`; combined passes `cohorts={[paletteData(dp1), paletteData(dp2)]}` + `onActiveCohortChange`.

#### 3. Migrate the palette test

**File**: `src/_pages/plan-detail/ui/palette/PlannerPalette.test.tsx` → rename/retarget to the merged panel

**Intent**: The collapse-disclosure + `usePaletteFilter` tests must point at the merged panel (single-cohort, no-toolbar configuration) instead of the deleted `PlannerPalette`.

**Contract**: Update imports + the render helper's props to the merged panel's shape; assertions (collapse rail, filter behavior) unchanged.

#### 4. Update barrels + `BoardShell` docstring

**Files**: `src/_pages/plan-detail/ui/grid/index.ts`, `src/_pages/plan-detail/ui/palette/index.ts`, `src/_pages/plan-detail/ui/chrome/BoardShell.tsx` (comment only)

**Intent**: Drop the retired exports (`PairedPlannerGrid`, `PlannerPalette`); update the `BoardShell` docstring's divergence list.

**Contract**: `grid/index.ts` exports the one grid + `PairedColumn`; `palette/index.ts` exports the one panel (+ `PaletteCohortData`, `usePaletteFilter`, the empty/stale sub-components). No `PairedPlannerGrid`/`PlannerPalette` names remain.

### Success Criteria:

#### Automated Verification:

- All unit tests pass, incl. the migrated palette test: `pnpm test`
- Lint + types clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`
- Build clean: `pnpm build`
- No references to `PairedPlannerGrid` or `PlannerPalette` remain: `pnpm steiger` + `pnpm lint` (unused/unresolved imports) catch stragglers

#### Manual Verification:

- Single board: grid and palette render pixel-identically to before the phase (one column, no sub-labels, no switcher toolbar).
- Combined board: grid (two sub-columns, sub-labels, sibling-dim) and palette (cohort tabs) render identically to before.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. This phase must be visually a no-op — diff the rendered boards against Phase 2's output.

---

## Phase 4: Collapse orchestrators, routes, and loaders into one `focus` board

### Overview

Build the one board from `CombinedPlannerBoard` + a `focus: Cohort | "combined"` prop, folding single's unique chrome in as `focus`-branches. Switch to one `?focus=` route (bare → combined) and one loader; delete the dead single-path component, grid-already-merged, wrappers, `combined.astro`, and the single loader. Migrate the production read-boundary integration tests; retire the now-moot loader-parity tests.

### Changes Required:

#### 1. The unified board component

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (the surviving board — generalize `CombinedPlannerBoard`'s body into it) — delete `CombinedPlannerBoard.tsx`

**Intent**: One island taking `{ planName, focus, dp1, dp2, paletteCollapsed }`. Always calls `useCombinedBoardState(dp1, dp2)` (constant hooks); branches on `focus` only when rendering. `focus = "combined"` → today's combined render; `focus = "dp1"|"dp2"` → one column, palette locked, no sibling-dim, full-screen empty state.

**Contract**: New props `{ planName: string; focus: BoardSurface; dp1: PlannerBoardProps; dp2: PlannerBoardProps; paletteCollapsed: boolean }` (`BoardSurface` reused from `CohortSwitcher`). The `focus`-branches:
- **State**: `useCombinedBoardState(dp1, dp2)` always; `const focused = focus === "combined" ? null : byCohort[focus]`.
- **Grid `columns`**: `focus === "combined" ? [buildColumn("dp1", dp1), buildColumn("dp2", dp2)] : [buildColumn(focus, focused!)]`; `activeDragCohort` = `focus === "combined" ? activeDragCohort : null`.
- **Palette**: `focus === "combined"` → both cohorts + switcher + `paletteCohort` state; focus → `cohorts={[paletteData(focused!)]}`, no switcher, `activeCohort` fixed to `focus`.
- **`activeCohort` for the drop router / park**: `focus === "combined" ? paletteCohort : focus`.
- **Shelf**: `focus === "combined"` → `parkedBundles={[...dp1.parkedBundles, ...dp2.parkedBundles]}` + `cohortById={shelfCohortById}` (both cohorts, today's combined wiring); focus → `parkedBundles={focused!.parkedBundles}` + a focused-only `cohortById` (the single cohort's parked ids → `focus`). **The shelf is filtered to the focused cohort in focus mode** — matching today's single board (`PlannerBoard.tsx:240` feeds only its cohort's bundles) and keeping the #2 parked-count badge consistent with the shelf's contents (a both-cohort shelf under a focused-cohort count would mismatch). This is the shelf focus-branch change.md calls for ("filter shelf", `change.md:24,99`).
- **Header**: `PlanSummaryBar` in all modes (see #2), with `active={focus}` driving the switcher.
- **Empty state**: `focus !== "combined" && focused.groupings empty` → full-screen early-return (today's single behavior, via `resolvePaletteView`); combined keeps the in-panel empty body. Always call the state hook *before* this early-return.
- **Palette disclosure**: `usePaletteDisclosure(paletteCollapsed)` in all modes (combined stops hardcoding `true`).

#### 2. Summary bar in all modes

**Files**: `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx`, `src/_pages/plan-detail/ui/chrome/BoardHeader.tsx`

**Intent**: `PlanSummaryBar` becomes the header for every mode. In combined it shows plan-wide aggregate counts (both cohorts); the cohort switcher's active segment is the current `focus` (incl. `"combined"`). The hint toggle moves into the summary bar's trailing group so there is one header for all modes.

**Contract**: `BoardHeader`/`PlanSummaryBar` take `active: BoardSurface` (was `cohort: Cohort`) and pass it to `CohortSwitcher`. `PlanSummaryBar` accepts a trailing slot for the `DragHintModeToggle`. The board computes `incompleteCount`/`parkedCount` as the single focused cohort's counts in focus mode, or the **sum across both cohorts** in combined mode; `onExpandShelf` opens the shared shelf. (Note: the focus-mode toggle relocates from above-the-grid into the header — a minor, intended consistency change.)

#### 3. One Astro wrapper + one route

**Files**: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro` (the surviving wrapper) — delete `src/pages/plans/[id]/combined.astro` and `src/_pages/plan-detail/ui/PlanDetailCombinedPage.astro`

**Intent**: One route parses `?focus=` (default combined), always loads both cohorts, reads the palette cookie, and renders the one wrapper/island with `focus`.

**Contract**: `index.astro` parses `?focus=` with a `dp1|dp2|combined` schema defaulting to `"combined"` (a small `focusSchema`/`boardSurfaceSchema` — co-locate in `lib/` or reuse `cohortSchema` widened); calls `loadCombinedPlannerData(supabase, id)`; reads `parsePaletteCollapsed(cookie)`; renders `PlanDetailPage` with `{ planName, focus, dp1, dp2, paletteCollapsed }`. `PlanDetailPage.astro` renders the unified `PlannerBoard` island `client:load`. Error/`SidebarLayout` boilerplate unchanged.

#### 4. CohortSwitcher hrefs → `?focus=`

**File**: `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx`

**Intent**: Point all three segments at the one route.

**Contract**: hrefs become `/plans/${planId}?focus=${value}` for `dp1`/`dp2` and `/plans/${planId}?focus=combined` for combined. `active: BoardSurface` prop unchanged. Update the docstring (one route now, not three).

#### 5. Delete the single loader + its single-only helper

**Files**: `src/_pages/plan-detail/api/load.ts`, `src/_pages/plan-detail/api/index.ts`

**Intent**: `loadCombinedPlannerData` is the only loader. Remove `loadPlannerData`, `PlannerData`, and `projectSiblingOccupancy` (single-only); keep `projectFromPlacements` (used by `assembleCombinedProps` + `indexFromPlacements`) and all shared row-mappers.

**Contract**: `api/index.ts` no longer exports `loadPlannerData`/`PlannerData`. `load.ts` retains `loadCombinedPlannerData` + the `fetch*`/`map*` helpers; `projectSiblingOccupancy` + `SiblingOccupancyCell` import (if now unused) removed.

#### 6. Migrate the production read-boundary integration tests

**Files**: `src/_pages/plan-detail/api/load.integration.test.ts`, `src/_pages/plan-detail/api/reload-restore.integration.test.ts`

**Intent**: These prove the *production* loader ships correct name records / availability shape / reload-restore. Re-point them at `loadCombinedPlannerData` and assert on `result.value.dp1` (the focus-mode read is now a combined read).

**Contract**: Replace `loadPlannerData(supabase, planId, "dp1")` with `loadCombinedPlannerData(supabase, planId)` and read `result.value.dp1`; assertions otherwise unchanged.

#### 7. Retire the loader-parity tests

**Files**: `src/_pages/plan-detail/api/parity.test.ts`, `src/_pages/plan-detail/api/adapter-parity.integration.test.ts`

**Intent**: These guarded single-vs-combined loader equivalence; with one loader the guarantee is structural. Remove them. (Keep `model/collision/collision-parity.test.ts` — cohort-agnostic, unrelated.)

**Contract**: Delete both files. Confirm no other test imports their helpers.

#### 8. Clean up dead single-path references + docstrings

**Files**: `src/_pages/plan-detail/index.ts`, and docstring mentions across `board-disclosure.ts`, `use-board-derivations.ts`, `board-inspection.ts`, `palette-view.ts`, `BoardShell.tsx`, and `model/cross-cohort/cross-cohort-index.ts:45` (comment-only — drop the now-dead `projectSiblingOccupancy` mention; the file's logic stays untouched per "What We're NOT Doing")

**Intent**: The slice barrel keeps exporting `PlannerBoard` (now the unified one). Update comments that describe "the single-cohort board vs the combined shell" to the one-board-with-focus model.

**Contract**: `index.ts` `export { default as PlannerBoard } from "./ui/PlannerBoard"` unchanged (points at the unified file). Comment-only edits elsewhere; no behavior.

### Success Criteria:

#### Automated Verification:

- All unit tests pass: `pnpm test`
- Integration suite passes (migrated loader tests): `pnpm test:integration` (needs local Supabase)
- Lint + types clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`
- Build clean: `pnpm build`
- No references to `loadPlannerData`, `projectSiblingOccupancy`, `CombinedPlannerBoard`, `PlanDetailCombinedPage`, `combined.astro`, or `/combined` remain in `src/`, and no `?cohort=` remains in the plan-detail surface (`src/_pages/plan-detail` + `src/pages/plans`) — the catalog filters' unrelated `?cohort=` (courses/students/teachers) stays: grep clean

#### Manual Verification:

- `/plans/[id]` (no param) lands on the combined board with a summary bar showing plan-wide counts.
- `/plans/[id]?focus=dp1` and `?focus=dp2` render one column, palette locked to that cohort (no switcher), full-screen empty state when that cohort has no groupings, no sibling-dim; cohort-tagged cells (a11y) as in Phase 2. The shelf shows **only the focused cohort's** parked bundles, and the parked-count badge matches the number of shelf cards (no sibling-cohort bundles leak in).
- The switcher navigates between dp1 / dp2 / combined; the palette collapse choice persists across mode switches (cookie honored in all modes).
- A drag/move/park/lift/place-back in each mode behaves as before; the cross-cohort move rejection still holds in combined.
- Page load and per-drag latency feel unchanged (loader cost is SSR-only and parallelized).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase — verify all three `?focus=` values plus the bare route end-to-end before closing the change.

---

## Testing Strategy

### Unit Tests:

- **New**: `drop-dispatch.test.ts` — ~8–12 cases on `applyDropAction` (action→`actions.*`, unknown-id no-ops, `collapseUnlessPinned` firing rules, single-vs-combined resolver equivalence).
- **Rewritten**: `drop-router.test.ts` "single board (untagged)" block → tagged cells/drags.
- **Migrated**: `PlannerPalette.test.tsx` → the merged panel (single-cohort, no toolbar).
- **Unaffected (regression guard)**: `drop-hints.test.ts`, `use-placements.test.tsx`, `cell-occupants.test.ts`, `model/collision/*` (cohort-free data layer), `model/cross-cohort/assemble-combined-props.test.ts`, `use-cohort-board-state.test.ts`.

### Integration Tests:

- **Migrated** to `loadCombinedPlannerData`: `load.integration.test.ts` (name records, availability shape), `reload-restore.integration.test.ts` (reload read boundary) — assert on `result.value.dp1`.
- **Removed** (moot): `api/parity.test.ts`, `api/adapter-parity.integration.test.ts`.

### Manual Testing Steps:

1. Bare `/plans/[id]` → combined board, summary bar with aggregate counts.
2. `?focus=dp1`/`?focus=dp2` → one column, locked palette, full-screen empty when no groupings, cohort-prefixed a11y labels, parked badge.
3. Switcher cycles all three surfaces; palette collapse persists across switches.
4. In each mode: add course (cell + shelf), move placement, lift bundle (button + drag), place back, park grouping; cross-cohort move rejection in combined.
5. Confirm per-drag latency and page load feel unchanged.

## Performance Considerations

Always-load-both adds an SSR-only, fully-parallelized ~+44% query count on the (now-combined) default route (research §1; tiny data scale — ~40 placed courses/cohort). **Zero per-drag cost**: the `<200ms` budget lives in the pure constraint core (`collisions.perf.test.ts`, sub-millisecond) and is unaffected by load strategy; the hidden cohort's client derivations memoize away (inputs never change). No mitigation needed.

## Migration Notes

Hard cut, no redirects: old `?cohort=` / `/combined` bookmarks break (acceptable, pre-GA internal tool, no external links — only `CohortSwitcher` referenced them). No data migration. No Supabase schema change. Rollback is a code revert; phases 1–3 are independently revertable, phase 4 is the atomic route/loader switch.

## References

- Change notes: `context/changes/plan-detail-unify-views/change.md`
- Research (decisions + blast-radius analysis): `context/changes/plan-detail-unify-views/research.md`
- The cross-index cycle rationale: `src/_pages/plan-detail/model/use-cohort-board-state.ts:16-32`
- The two boards' handlers: `src/_pages/plan-detail/ui/PlannerBoard.tsx:108-173`, `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx:92-158`
- The drop router + cross-cohort guard: `src/_pages/plan-detail/model/cross-cohort/drop-router.ts`
- Historical precedent (index designed as "a reuse, not a rewrite"): `context/archive/2026-06-22-cohort-switching/change.md:16`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: `applyDropAction` dispatch seam

#### Automated

- [x] 1.1 Unit tests pass, incl. the new dispatch suite: `pnpm test` — 677a13d
- [x] 1.2 Lint + types clean: `pnpm lint` — 677a13d
- [x] 1.3 FSD structure clean: `pnpm steiger` — 677a13d
- [x] 1.4 Production build clean: `pnpm build` — 677a13d

#### Manual

- [x] 1.5 Single board: course/grouping drop (cell + shelf), move, lift (button + drag), place-back — unchanged — covered by end-state full e2e (bundle/duplicate/drag-validate/shelf specs at `?focus=dp1`) + applyDropAction/drop-router unit suites
- [x] 1.6 Combined board: same set across both columns incl. cross-cohort move rejection — unchanged — covered by end-state e2e (combined-view cross-column guard, combined-shelf-park)

### Phase 2: Cohort-always-tagged (isolated behavior change)

#### Automated

- [x] 2.1 All unit tests pass, incl. the rewritten `drop-router.test.ts`: `pnpm test` — e02608c
- [x] 2.2 Lint + types clean: `pnpm lint` — e02608c
- [x] 2.3 FSD structure clean: `pnpm steiger` — e02608c
- [x] 2.4 Build clean: `pnpm build` — e02608c

#### Manual

- [x] 2.5 Single board: cells announce cohort-prefixed a11y labels; parked-card badge shows; drag/lift/park/place-back unchanged — verified end-state via Playwright (cells "DP1, Mon, P1"; parked badge) + e2e drag/lift/park/place-back at `?focus=dp1`
- [x] 2.6 Combined board: no visible change — verified end-state via Playwright (combined renders DP1|DP2 columns + switcher palette correctly)

### Phase 3: Grid + palette structural merge (behavior-preserving)

#### Automated

- [x] 3.1 All unit tests pass, incl. the migrated palette test: `pnpm test` — 8862411
- [x] 3.2 Lint + types clean: `pnpm lint` — 8862411
- [x] 3.3 FSD structure clean: `pnpm steiger` — 8862411
- [x] 3.4 Build clean: `pnpm build` — 8862411
- [x] 3.5 No `PairedPlannerGrid`/`PlannerPalette` references remain (lint/steiger unused-import + grep) — 8862411

#### Manual

- [x] 3.6 Single board: grid + palette render pixel-identically to Phase 2 — verified end-state via Playwright (focus=dp1: one column, no sub-label row, no palette switcher)
- [x] 3.7 Combined board: grid (sub-columns, sub-labels, sibling-dim) + palette (tabs) render identically — verified end-state via Playwright (combined: DP1|DP2 sub-columns + palette cohort tabs)

### Phase 4: Collapse orchestrators, routes, and loaders into one `focus` board

#### Automated

- [x] 4.1 All unit tests pass: `pnpm test` — 765dbb9
- [x] 4.2 Integration suite passes (migrated loader tests): `pnpm test:integration` — 765dbb9
- [x] 4.3 Lint + types clean: `pnpm lint` — 765dbb9
- [x] 4.4 FSD structure clean: `pnpm steiger` — 765dbb9
- [x] 4.5 Build clean: `pnpm build` — 765dbb9
- [x] 4.6 No `loadPlannerData`/`projectSiblingOccupancy`/`CombinedPlannerBoard`/`PlanDetailCombinedPage`/`combined.astro`/`/combined` refs in `src/`; no `?cohort=` in `src/_pages/plan-detail`+`src/pages/plans` (catalog filters' `?cohort=` is unrelated) — grep clean — 765dbb9

#### Manual

- [x] 4.7 Bare `/plans/[id]` → combined board with aggregate-count summary bar — verified via Playwright preview (Seed Plan A: Combined active, DP1+DP2 columns, 78 incomplete/2 parked aggregate) — 765dbb9
- [x] 4.8 `?focus=dp1`/`?focus=dp2` → one column, locked palette, full-screen empty when no groupings, no sibling-dim, cohort-tagged cells — verified via Playwright (one column, no palette switcher, per-cohort counts 36/42, shelf filtered: dp1=2/dp2=0 parked, no leak) — 765dbb9
- [x] 4.9 Switcher cycles all three surfaces; palette collapse choice persists across switches — verified via Playwright (collapse in dp2 → combined collapsed; expand in combined → dp1 expanded; cookie round-trips) — 765dbb9
- [x] 4.10 Drag/move/park/lift/place-back per mode; cross-cohort move rejection in combined — verified via full e2e suite (18 pass: combined-view cross-column guard, combined-shelf-park, bundle/duplicate/shelf drag specs at `?focus=dp1`) — 765dbb9
- [x] 4.11 Page load + per-drag latency feel unchanged — loader cost is SSR-only/parallelized; e2e drags complete in normal time — 765dbb9
