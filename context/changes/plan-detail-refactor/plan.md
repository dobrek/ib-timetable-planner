# Plan-Detail Slice Refactor Implementation Plan

## Overview

A **fully behavior-preserving** refactor of `src/_pages/plan-detail/` — the app's largest slice. The
feature set is complete; this pass kills the duplication between the single board (`/plans/[id]`) and
the combined board (`/plans/[id]/combined`), restructures `ui/` into five intent-named folders, lands a
shared `CollapsibleEdgePanel` (which also fixes the combined palette-header hierarchy bug), and cleans
the `model/`/`api/` tail. Both routes must keep working identically (the one intended visible change is
the cohort switcher moving from above the palette header to a toolbar slot below it).

The prerequisite `combined-view-park-gap` is **merged and green** at HEAD `4039b66`, so both boards now
park-to-shelf symmetrically through `model/parked-members.ts`. That dissolved the only behavioral/product
risk; the drop-router unification is now ordinary refactor work. Characterization tests are written
immediately before each untested seam they protect.

## Current State Analysis

The slice is genuinely well-built: pure domain logic in `model/` cleanly split from hooks split from UI,
a disciplined optimistic-write path, an extensible constraint registry, and a deliberately-handled
cross-cohort live-index cycle. The findings are refinement, not rescue. The duplication is concentrated:

- **Two per-cohort state assemblies kept in sync by hand.** `PlannerBoard.tsx:50-98` assembles per-cohort
  state inline; `use-cohort-board-state.ts:73-129` (`useCohortPlacements` + `useCohortDerivations`)
  re-assembles the _same set_ for the combined view. The code admits it (`use-cohort-board-state.ts:17`).
- **The DnD board shell is copy-pasted.** `PLUGINS` is byte-identical (`PlannerBoard.tsx:279-281` ==
  `CombinedPlannerBoard.tsx:282-284`); the `DragDropProvider` → flex column → 3-col grid
  (`lg:grid-cols-[auto_minmax(0,1fr)_auto]`) → banner/toggle/shelf/dialog/overlay scaffold is parallel;
  the drop dispatch is structurally parallel (`PlannerBoard.tsx:110-148` vs `CombinedPlannerBoard.tsx:89-136`).
- **Cell-wiring is hand-threaded in the single path.** `CellWiring` (11 fields, `SlotCellHost.tsx:17-33`)
  is re-listed at every hop `PlannerGrid → PeriodRow → SlotCellHost` (`PlannerGrid.tsx:27-37,79-84,100-106,130-136`).
  The combined path already does it right: one bundled `wiring` object + `{...column.wiring}` spread
  (`CombinedPlannerBoard.tsx:177-193`, `PairedPlannerGrid.tsx:104`).
- **The palette and shelf are the same drawer.** `PALETTE_ICON_BUTTON` (`PlannerPalette.tsx:28`) and
  `SHELF_ICON_BUTTON` (`shelf/ShelfDrawer.tsx:26`) are byte-identical; both render a width-animated
  `<aside>` (rail ↔ open), a collapsed rail (icon + count, display-class toggle), and an expanded header
  (icon + label + count + `ml-auto` icon-buttons). The combined cohort switcher floats _above_ the
  palette's own header (`CombinedPalettePanel.tsx:52-69`) — the hierarchy reads inverted.
- **`model/` is a ~45-source flat folder**; `ui/` is ~30 files flat at the root with `slot-cell/` and
  `shelf/` already nested. `model/constraints/`, `ui/slot-cell/`, `ui/shelf/` prove nested segment
  folders pass steiger.
- **Thin board-layer test net.** The pure `model/` core is densely unit-tested (the safety net). But the
  single board's `handleDrop` has **no** `PlannerBoard.test`, `use-board-derivations.ts` has no test, and
  the combined route's live re-validation cycle is only tested at the `indexFromPlacements` leaf.

## Desired End State

- Both boards are thin shells over a **single shared per-cohort state assembler** and a **single
  `BoardShell`** layout; one shared `PLUGINS`; one shared `resolveCombinedDrop` drop router (single board
  = degenerate one-cohort case).
- `ui/` root holds only the 3 `.astro` route entries + the 2 board orchestrators; everything else lives
  under `palette/`, `grid/` (with `slot-cell/` folded in), `shelf/`, `overlay/`, `chrome/`.
- A shared `CollapsibleEdgePanel` backs both palette and shelf; the combined cohort switcher sits in a
  `toolbar` slot below the panel header (hierarchy fixed); the combined palette's empty/stale/ready
  bodies swap _under_ a constant header+toolbar.
- The single-path cell wiring is one bundled object + `{...wiring}` spread.
- `model/` is grouped into sub-folders; the `collision.ts`/`collisions.ts` and
  `combined-drop`/`combined-props` naming collisions are resolved; the `cellKey` re-export is dropped.
- `api/` boilerplate collapses to `callAction`; `grouping-client` aligns to the `{ error }` shape +
  `refreshPage()`; `toPlannerPlacement` is de-duplicated.
- `ui-conventions.md` carries the three amendments that justify the new structure.

**Verification of the end state**: the full local gate is green (`pnpm check` · `lint` · `steiger` ·
`test` · `build`), `pnpm test:integration` and `pnpm test:e2e` pass, and both routes behave identically
to today (modulo the intended switcher reposition) under manual smoke.

### Key Discoveries

- **The combined view already invented the better seams**: the bundled-`wiring`-object + spread
  (`PairedPlannerGrid.tsx:104`) and the per-cohort state unit (`CohortBoardState`,
  `use-cohort-board-state.ts:60-68`). Most of this refactor is "make the single board adopt the combined
  view's tested-in-production patterns," not "invent new abstractions."
- **Router unification needs cohort-tagging on the single board** (see Critical Implementation Details):
  `resolveCombinedDrop` resolves `targetCohort = cell?.cohort` and guards moves with
  `data.cohort === targetCohort` (`combined-drop.ts:35,45,56`). Single-board cells/drags carry no cohort
  today, so the unification must tag them with the board's one cohort.
- **No React Compiler transform** — only the ESLint plugin (`astro.config.mjs:37`, `package.json:70`,
  rule severity `error`). Memoization is **all manual**; any new shared value (assembler return, wiring
  object) must be referentially stable, and a broad-fan-out Context value would re-render all cells on
  every drag tick — which is why the wiring fix is the spread, **not** Context.
- **`astro check` is the only type gate** (lessons.md). Success criteria cite `pnpm check`, never
  `pnpm build`/`lint`, for type safety.
- **steiger watch-item**: keep a folder name distinct from its single dominant export
  (`fsd/repetitive-naming`/`fsd/ambiguous-slice-names`) — e.g. don't make a `collision/` folder whose
  barrel re-exports a `collision`. `model/constraints/` proves a concept-named folder with named exports passes.

## What We're NOT Doing

- **No behavior changes** beyond the intended palette cohort-switcher reposition. The single board keeps
  its full-screen `empty` early-return that skips the whole island (`PlannerBoard.tsx:177-186`) — that
  divergence is genuinely board-level and stays.
- **No global store / no wiring Context** — settled; the spread pattern is the fix.
- **No constraint-core changes** — the `model/` constraint/validation engine and the cross-cohort cycle
  design are preserved exactly; we only _move_ and _rename_ files, never alter the algorithms.
- **No re-write of the research §C body** — the 2026-06-27 21:59 follow-up in `research.md` is the
  current source of truth for the (now-closed) park parity; the older §C body is superseded, not a deliverable.
- **No new e2e coverage of the Week A/B toggle or single-board empty state** beyond what exists.

## Implementation Approach

Sequence so risk falls _after_ its safety net: characterization tests first (Phase 1), then the low-risk
structural moves (Phases 2–3), then the board-core unification in increasing-risk order (Phases 4–7),
then the droppable mechanical tail (Phases 8–9). The three `ui-conventions.md` amendments ride with the
phases they justify so the structure is self-documenting. Verification cadence (per decision): every
phase runs the **fast gate** (`pnpm check` + `lint` + `steiger` + `test`); the **board-wiring boundary**
phases (3–7) additionally run `pnpm test:e2e` (and `pnpm test:integration` where api/cross-cohort state
is touched); the api phase (9) runs `pnpm test:integration`; the full suite runs once at the end.

## Critical Implementation Details

- **The cross-cohort live-index cycle is load-bearing and must be preserved (Phase 5).** Both cohorts'
  `usePlacements` run first against the **static SSR-seed** index; each cohort's **live** index is
  `useMemo`'d from the _other_ cohort's current placements (fresh Map identity each build) and feeds
  `useCollisions`/`useDragHints` (`use-cohort-board-state.ts:16-64`). The seed (not live) feeds
  `usePlacements` because a live value would force a render-time ref read (forbidden). The shared
  assembler must keep this exact sequencing; the single board passes its one static index as **both**
  seed and fresh (it has no live sibling). The `not.toBe` fresh-identity assertion in
  `use-cohort-board-state.test.ts` is the regression guard — extend it, don't weaken it.

- **Router unification requires cohort-tagging the single board (Phase 7).** `resolveCombinedDrop`
  returns `null` for a cell drop whose `cell.cohort` is undefined, and rejects a move when
  `data.cohort !== targetCohort` (`combined-drop.ts:40,45,56`). The single board's cells (`SlotCellHost`
  `cohort?` absent) and relocating drags carry no cohort today. To route the single board through the
  shared router behavior-preservingly, tag its cells **and** its `placement`/`bundle`/`parked` drags with
  the board's one cohort so `targetCohort` always resolves and `data.cohort === targetCohort` is a trivial
  pass (the cross-cohort guard never fires with one cohort). The combined board already exercises this
  cohort-carrying path, so it is the tested code path — `SlotCellHost` accepts `cohort?` (used only to
  namespace dnd ids; harmless under the single board's one provider). This is the substantive part of
  "single = degenerate one-cohort case" and the reason Phase 7 is gated by Phase 1's `handleDrop`
  characterization.

- **Render purity is lint-enforced (all phases).** No refs read during render; no setState-in-effect for
  derived state (derive during render / adjust-state-during-render — precedents at
  `use-board-derivations.ts`, `PlannerPalette.tsx:183-187`, `CombinedPlannerBoard.tsx:71-77`). Any new
  shared value computed in render must satisfy both, and must be referentially stable (manual memo) since
  there is no compiler transform.

- **Co-located tests move with their source (Phases 2, 8).** Tests import the unit-under-test by relative
  path; a file move breaks the import unless the test moves too and its `../` depth is adjusted
  (`ui/slot-cell/SlotCell.test.tsx` already uses depth-sensitive `../../`). `pnpm check` + `pnpm steiger`
  catch any miss.

---

## Phase 1: Characterization tests for the untested board seams

### Overview

Close the board-layer blind spots before any architectural move. Extracting the single board's inline
`handleDrop` into a pure, tested resolver is both the characterization _and_ the on-ramp to the Phase 7
router unification.

### Changes Required

#### 1. Single-board drop resolver

**File**: `src/_pages/plan-detail/model/` (new pure resolver, e.g. `single-drop.ts` + `single-drop.test.ts`)

**Intent**: Lift the pure decision in `PlannerBoard.handleDrop`'s `switch (data.kind)` into a pure
function that maps `(DragData, DropTargetData)` → a resolved action descriptor (place / move / park /
lift / placeBack / no-op), mirroring `resolveCombinedDrop`'s shape. `PlannerBoard` keeps the thin
effectful wiring (calling the `usePlacements` actions + `collapseUnlessPinned`); only the branching logic
moves out so it can be unit-tested.

**Contract**: A pure resolver returning a discriminated action union analogous to `CombinedDropAction`
(minus the cohort guard). The single board's `handleDrop` becomes: resolve → `switch (action.kind)` →
call the matching action. Behavior identical to `PlannerBoard.tsx:110-148`, including park-to-shelf via
`defaultParkedWeek`/`groupingParkedMembers` and the `parked × shelf` / `placement × shelf` no-ops.

#### 2. `use-board-derivations` characterization test

**File**: `src/_pages/plan-detail/model/use-board-derivations.test.ts` (new)

**Intent**: Pin the shared derivation hooks (`useCollisions`/`useHours`/`useDragHints`/`useDuplicateHighlight`/
`useCatalogById`/`useAvailabilityIndex`) the assembler routes through, so Phase 5 can't silently change them.

**Contract**: Render-hook tests asserting the derived outputs and referential stability across re-renders
for fixed inputs (the manual-memo contract). Use the existing `model/__fixtures__/builders.ts`.

#### 3. Combined live-mutation cycle test

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.test.ts` (extend)

**Intent**: Prove "edit one cohort → the sibling re-validates in the same render" end-to-end through
`useCombinedBoardState`, not just the `indexFromPlacements` leaf — the property Phase 5/7 must not break.

**Contract**: Extend the existing `not.toBe` fresh-identity test with a mutation case: drive a placement
into dp1, assert dp2's `collisions` reflect the new cross-cohort occupancy in the same render pass.

### Success Criteria

#### Automated Verification

- New resolver unit tests pass: `pnpm test`
- `use-board-derivations` test + extended cycle test pass: `pnpm test`
- Type gate clean: `pnpm check`
- Lint + structure clean: `pnpm lint` && `pnpm steiger`

#### Manual Verification

- Single board: place / move / duplicate / lift / park course / park grouping / place-back all behave
  exactly as before (drop dispatch now goes through the extracted resolver).

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: `ui/` five-folder restructure

### Overview

Move `ui/` to root = 3 `.astro` + 2 board orchestrators; everything else under `palette/`, `grid/`
(fold `slot-cell/` in), `shelf/` (exists), `overlay/`, `chrome/`. Promote `drag-inert.ts` → slice `lib/`.
Pure file moves + relative-path rewrites + barrels — no behavior change. Lands convention amendment (c).

### Changes Required

#### 1. Folder moves + barrels

**File**: `src/_pages/plan-detail/ui/**`

**Intent**: Relocate components into the five folders per the finalized tree (`change.md` §"Finalized
`ui/` structure"; `research.md` Decision 3). Add a multi-public `index.ts` barrel to `palette/`
(exporting `PlannerPalette`, `CombinedPalettePanel`, `ComputeGroupingsEmptyState`, `GroupingStalePanel`)
and `grid/`; `overlay/` and `chrome/` get barrels as their import edges warrant. Move every co-located
test with its source and fix `../` depth.

**Contract**: Final `ui/` tree —
`palette/` (PlannerPalette · CombinedPalettePanel · GroupingFilter · GroupingBox · PaletteCourseChip ·
HoursCounter · ComputeGroupingsEmptyState · GroupingStalePanel + tests + `index.ts`);
`grid/` (PlannerGrid · PairedPlannerGrid · `slot-cell/` folded in + `index.ts`);
`shelf/` (ShelfDrawer · ParkedBundleCard);
`overlay/` (GroupDragOverlay · CollisionDetailsDialog);
`chrome/` (BoardHeader · PlanSummaryBar · CohortSwitcher · DragHintModeToggle · ErrorBanner ·
board-disclosure.ts · board-inspection.ts).
Root: `PlanDetailPage.astro` · `PlanDetailCombinedPage.astro` · `PlanDetailError.astro` ·
`PlannerBoard.tsx` · `CombinedPlannerBoard.tsx`. Multi-public barrels mirror `model/constraints/`. All
imports stay relative within the slice.

#### 2. `drag-inert.ts` → slice `lib/`

**File**: `src/_pages/plan-detail/ui/slot-cell/drag-inert.ts` → `src/_pages/plan-detail/lib/drag-inert.ts`

**Intent**: `drag-inert.ts` (`stopDrag`) is a generic drag utility used by both `slot-cell/` and
`shelf/ParkedBundleCard.tsx:8`. Promoting it to slice `lib/` removes the cross-folder `shelf → grid`
import edge (cleaner than repointing to `../grid/slot-cell/drag-inert`).

**Contract**: New `lib/drag-inert.ts`; both consumers import from `../lib/drag-inert` (or relative
equivalent). No logic change.

#### 3. Root `index.ts` surface + convention amendment (c)

**File**: `src/_pages/plan-detail/index.ts`, `context/foundation/ui-conventions.md`

**Intent**: Keep the slice root `index.ts` to the page island surface per convention (`ui-conventions.md:166`);
the `.astro` routes continue importing the board/page entries by their (new) deep paths (Astro routing
pattern). Land amendment (c): widen the "folder-with-barrel" idiom (`ui-conventions.md:64-68`) to bless
the multi-public feature folder (the `model/constraints/` multi-export barrel already precedents it).

**Contract**: `ui-conventions.md` §"Folder-with-barrel graduation" gains the multi-public-component
feature-folder form alongside the single-default-barrel form. Root `index.ts` left coherent (`fsd/public-api`
only requires the file to exist).

### Success Criteria

#### Automated Verification

- Structure gate clean (the primary gate for this phase): `pnpm steiger`
- Type gate clean (catches any moved-import miss): `pnpm check`
- Moved co-located tests still pass: `pnpm test`
- Lint clean: `pnpm lint`
- Production build clean: `pnpm build`

#### Manual Verification

- Both routes render and behave identically (this phase is pure file movement).

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Shared `CollapsibleEdgePanel` + palette-header fix

### Overview

Extract one shell that both palette and shelf consume (kills the mirrored chrome + the duplicated
`*_ICON_BUTTON`); move the combined cohort switcher into a `toolbar` slot below the header (the UX fix);
unify the combined palette's empty/stale/ready bodies under a constant header+toolbar; route the single
board's **ready + stale** palette bodies through the shell (its full-screen `empty` early-return stays).
Wiring boundary → e2e. Lands a `CollapsibleEdgePanel` unit test.

### Changes Required

#### 1. `CollapsibleEdgePanel` shell

**File**: `src/_pages/plan-detail/ui/chrome/CollapsibleEdgePanel.tsx` (new) + `CollapsibleEdgePanel.test.tsx`

**Intent**: One width-animated `<aside>` with a collapsed rail (icon + count) and an expanded
header (icon + label + count + actions + collapse chevron), parameterized by edge side. The `toolbar`
slot (rendered below the header, above the body, only when expanded) is what fixes the palette-header
hierarchy. Palette and shelf become thin compositions over it.

**Contract**:

```
CollapsibleEdgePanel
  side: "left" | "right"          // chevron direction + rail edge; left=palette, right=shelf
  icon, label, count              // header identity + collapsed-rail content
  collapsed, onCollapsedChange    // disclosure
  headerActions?: ReactNode       // shelf: pin button, before the collapse chevron
  toolbar?: ReactNode             // below header, above body, expanded-only — palette: cohort Tabs
  children: ReactNode             // body: palette filter+list | shelf parked cards
```

The shelf is the island-wide droppable + carries the `isDropTarget` ring + the disable-collapse-when-pinned
rule. **Resolved: `ShelfDrawer` composes `CollapsibleEdgePanel` and owns its own droppable wrapper** — the
shell stays a pure presentational chrome (no `forwardRef`, no `isDropTarget`/drop-styling props the palette
would never use), and the `useDroppable` (`ShelfDrawer.tsx:51`), the `ring-ring ring-2` drop ring, and the
pin/disable-collapse rule all stay inside `ShelfDrawer` exactly where they live today (minimal
behavior-move risk). Wrap the panel in the droppable element so **both** the collapsed rail and the
expanded body remain inside the drop target (today the whole `<aside>` is the target, so a drop onto the
collapsed tab still parks — preserve that), and confirm the drop ring still reads on the same visual box.
Preserve the display-class collapse toggle (draggable sources survive collapse) and the existing
rail/header accessible names (`aria-label` "Open palette (N groupings)" / "Open shelf (N parked)",
"Collapse palette/shelf").

#### 2. Refactor `PlannerPalette` + `ShelfDrawer` onto the shell

**File**: `src/_pages/plan-detail/ui/palette/PlannerPalette.tsx`, `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx`

**Intent**: Replace each component's hand-rolled `<aside>`/rail/header chrome with `CollapsibleEdgePanel`;
the palette body becomes the filter + list `children`, the shelf body the parked-card list `children`
with its pin button passed as `headerActions`. Remove the duplicated `PALETTE_ICON_BUTTON`/`SHELF_ICON_BUTTON`.

**Contract**: Identical rendered structure and ARIA to today (role-based e2e must still pass). The
single-board palette `w-64` and shelf `w-60` open widths are preserved (per-side constant or prop).

#### 3. Combined palette state-unification + switcher reposition

**File**: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx`

**Intent**: The `CollapsibleEdgePanel` (header + `toolbar` cohort Tabs) is **always** rendered; only the
**body** swaps on `resolvePaletteView(active)` → ready (filter+list) / stale (recompute) / empty (compute
prompt). The cohort `Tabs` move from above the panel (`CombinedPalettePanel.tsx:52-69`) into the `toolbar`
slot — fixing the inverted hierarchy and auto-hiding when collapsed.

**Contract**: Header + switcher constant across all three states; the author can switch cohorts even when
one cohort is empty/stale. This is the **combined** palette (per-cohort). The cohort `Tabs` keeps its
`aria-label="Palette cohort"` and value semantics.

#### 4. Single board: ready + stale via the shell

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Route the single board's `ready` and `stale` palette bodies through `CollapsibleEdgePanel`
(consistent chrome with combined). Keep the board-level `empty` early-return (`PlannerBoard.tsx:177-186`)
unchanged — that full-screen compute prompt skips the whole island and stays board-level.

**Contract**: `paletteView === "stale"` renders the stale body inside the shell instead of the bare
`GroupingStalePanel` column; `ready` renders the palette body inside the shell; `empty` still early-returns.

### Success Criteria

#### Automated Verification

- `CollapsibleEdgePanel` unit test passes: `pnpm test`
- Existing palette tests (`PlannerPalette.test.tsx`, `GroupingStalePanel.test.tsx`) pass: `pnpm test`
- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- e2e green (shelf chrome refactored): `pnpm test:e2e` — incl. `shelf-durability.spec.ts`,
  `combined-view.spec.ts`, `combined-shelf-park.spec.ts`
- Build clean: `pnpm build`

#### Manual Verification

- Combined view: cohort switcher now sits **below** the palette header (the fix); switching cohorts works
  in ready / stale / empty states; switcher hidden when palette collapsed.
- Single board: palette collapse/expand, filter, and the stale recompute panel behave as before; the
  empty state still shows the full-screen compute prompt.
- Shelf: park / place-back / pin / auto-collapse-on-drop / drag-out-while-collapsed all unchanged on both routes.

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: Single-path cell-wiring → bundled object + spread

### Overview

Adopt the combined view's wiring pattern in the single path: build one `CellWiring` object at the board,
pass it as one field, spread it once. `PlannerGrid`/`PeriodRow` stop re-listing 11 fields per hop.
Wiring boundary → e2e. Lands convention amendment (a).

### Changes Required

#### 1. `PlannerGrid` consumes a bundled `wiring`

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Stop threading the 11 `CellWiring` fields by hand through `PlannerGrid → PeriodRow →
SlotCellHost`. Accept one `wiring: CellWiring` prop and `{...wiring}` it into `SlotCellHost` exactly as
`PairedPlannerGrid.tsx:104` does; `PeriodRow` either receives `wiring` whole or is inlined.

**Contract**: `PlannerGrid` Props change from `CellWiring & {...}` to `{ wiring: CellWiring; ... }`;
`SlotCellHost` already accepts `CellWiring & {...}` so the spread is drop-in. Identical render + ARIA.

#### 2. `PlannerBoard` builds the wiring object + convention amendment (a)

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `context/foundation/ui-conventions.md`

**Intent**: Assemble one `wiring` object at the board (mirroring `CombinedPlannerBoard.buildColumn`'s
`wiring`) and pass it to `PlannerGrid`. Land amendment (a): keep the no-Context rule but document the
_real_ rationale (no compiler transform → manual memo; `dropHints`/`hintMode` change every drag tick → a
single Context value re-renders all cells against the <200ms budget).

**Contract**: The `wiring` object must be referentially stable per the manual-memo contract — pinned by
a referential-stability unit assertion (render the board/grid twice with stable inputs, assert the
`wiring` identity survives via `toBe`), mirroring the Phase 1 `use-board-derivations` stability test so a
fresh-object regression fails the fast gate instead of surfacing only as manual drag-lag.
`ui-conventions.md` §"State management" gains the drag-budget rationale.

### Success Criteria

#### Automated Verification

- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- Unit suite passes: `pnpm test`
- Wiring-object referential-stability unit test passes (render twice with stable inputs → `toBe` identity): `pnpm test`
- e2e green (single-board specs): `pnpm test:e2e`
- Build clean: `pnpm build`

#### Manual Verification

- Single board: hover hints, week toggle, remove, bundle toggle/duplicate/lift, inspect dialog all behave
  identically; no perf regression on drag (hints stay snappy).

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Shared per-cohort `useCohortBoardState` assembler

### Overview

Make `PlannerBoard` consume the same per-cohort assembly the combined view uses, passing its one static
cross-cohort index as **both** seed and fresh. One assembler, both routes. Wiring boundary → integration + e2e.
Lands convention amendment (b).

### Changes Required

#### 1. Per-cohort assembler API

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Expose a per-cohort assembler `useCohortBoardState(props, seedIndex, freshIndex)` over the
existing `useCohortPlacements` + `useCohortDerivations` pieces. `useCombinedBoardState` keeps the
cycle-resolving sequencing (seed → both `usePlacements` → live index from the sibling → fresh into
derivations). The single board calls the same assembler with its one static index as both args.

**Contract**: New exported `useCohortBoardState(props, seed, fresh): CohortBoardState`. The cycle
invariant in the file's load-bearing comment (`:16-64`) is preserved; the `not.toBe` fresh-identity test
(extended in Phase 1) continues to pass. When `seed === fresh` (single board), the result reproduces the
single board's current wiring.

#### 2. `PlannerBoard` adopts the assembler + convention amendment (b)

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `context/foundation/ui-conventions.md`

**Intent**: Replace the inline assembly (`PlannerBoard.tsx:50-98`) with one `useCohortBoardState` call,
passing `crossCohortIndex` as both seed and fresh (single-cohort has no live sibling). The board keeps its
own drop dispatch, disclosure, and inspection visible (no orchestration bag). Land amendment (b):
distinguish "per-cohort state unit (fine — the combined view already relies on it)" from
"orchestration bag (bad)".

**Contract**: `PlannerBoard` destructures the per-cohort state unit and keeps `handleDrop`/disclosure/
inspection in the component. `ui-conventions.md` §"Hook granularity"/design-goals gains the
per-cohort-unit-vs-bag distinction. No behavior change.

### Success Criteria

#### Automated Verification

- Cycle/identity + live-mutation tests pass: `pnpm test`
- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- Cross-cohort integration tests pass: `pnpm test:integration`
- e2e green (both routes): `pnpm test:e2e`
- Build clean: `pnpm build`

#### Manual Verification

- Single board: all placement/collision/hours/hint behavior identical (now via the shared assembler).
- Combined view: editing one cohort still re-validates the sibling live in the same interaction
  (cross-cohort clash appears/clears immediately).

**Implementation Note**: Pause for manual confirmation before Phase 6.

---

## Phase 6: `BoardShell` + shared `PLUGINS`

### Overview

Extract one `BoardShell` layout (the `DragDropProvider` → flex column → 3-col grid → banner/toggle/
palette/grid/shelf/dialog/overlay scaffold) and one shared `PLUGINS`; reconcile the structural
divergences as shell concerns. Both boards become thin shells. Wiring boundary → e2e.

### Changes Required

#### 1. Shared `PLUGINS`

**File**: `src/_pages/plan-detail/ui/chrome/` (or co-located with `BoardShell`)

**Intent**: De-duplicate the byte-identical `PLUGINS` const (`PlannerBoard.tsx:279-281` ==
`CombinedPlannerBoard.tsx:282-284`) into one shared module both boards import.

**Contract**: One exported `PLUGINS`; both boards import it. Identical dnd behavior (`dropAnimation: null`).

#### 2. `BoardShell` layout

**File**: `src/_pages/plan-detail/ui/BoardShell.tsx` (new; root, as a third orchestrator) or `ui/chrome/`

**Intent**: Extract the shared scaffold with slots: header, palette, grid, shelf, dialog, overlay,
error-banner(s), hint toggle. Each board supplies its slot content; `BoardShell` owns the
`DragDropProvider plugins={PLUGINS}` + the flex column + the `lg:grid-cols-[auto_minmax(0,1fr)_auto]` grid.

**Contract**: `BoardShell` reconciles the known divergences without changing behavior —

- single board keeps its `empty` early-return _outside_ the shell (renders `BoardHeader` +
  `ComputeGroupingsEmptyState`, skips the island);
- header slot differs (single: `PlanSummaryBar`; combined: inline header + `CohortSwitcher`);
- error-banner slot is 1 (single) vs up-to-2 per-cohort (combined);
- overlay slot passes `placementsByCohort` only in combined;
- the inspection dialog wiring differs (single: `useCollisionInspection`; combined: shell-owned single
  inspection across columns) — keep each board's inspection ownership, the shell only provides the slot.
  Decide the landing folder during this step (root third-orchestrator vs `chrome/`).

### Success Criteria

#### Automated Verification

- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- Unit suite passes: `pnpm test`
- e2e green (both routes): `pnpm test:e2e`
- Build clean: `pnpm build`

#### Manual Verification

- Single board: empty / stale / ready states, summary bar badges, error banner, inspect dialog all
  behave identically.
- Combined view: dual error banners, cohort switcher header, cross-column overlay disambiguation, and the
  single shared inspection dialog (opening one column's closes the other's) all behave identically.

**Implementation Note**: Pause for manual confirmation before Phase 7.

---

## Phase 7: Unified drop router

### Overview

Fold the single board's pure resolver (Phase 1) onto the shared `resolveCombinedDrop` — single board =
degenerate one-cohort case. One drop dispatch for both boards. The riskiest move; gated by Phase 1's
characterization. Wiring boundary → integration + e2e.

### Changes Required

#### 1. Cohort-tag the single board's cells + drags

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `ui/grid/PlannerGrid.tsx`,
`ui/grid/slot-cell/SlotCellHost.tsx` (drag sources as needed)

**Intent**: Make the single board's cells and `placement`/`bundle`/`parked` drags carry the board's one
cohort, so `resolveCombinedDrop` resolves `targetCohort` and its `data.cohort === targetCohort` guard is a
trivial pass (one cohort can never differ from itself). See Critical Implementation Details.

**Contract**: Single-board `SlotCellHost` receives `cohort={cohort}` (the prop already exists; used only
to namespace dnd ids — harmless under one provider); single-board relocating drag `data` carries `cohort`.
The combined board already exercises this path. No visible behavior change.

#### 2. Route single board's `handleDrop` through `resolveCombinedDrop`

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`, `src/_pages/plan-detail/model/combined-drop.ts`
(+ test), retire `single-drop.ts`

**Intent**: Replace the single board's resolver call with `resolveCombinedDrop(data, target, cohort)`
(its one cohort as `activeCohort`), and dispatch the returned action via the board's actions — identical
in shape to `CombinedPlannerBoard.handleDrop` (`:99-136`). Retire the Phase-1 `single-drop.ts` resolver
once parity is proven (its tests fold into `combined-drop.test.ts`).

**Contract**: After this phase there is **one** drop router. The single board's park/lift/place-back and
the `parked × shelf` / `placement × shelf` no-ops are unchanged. `combined-drop.test.ts` gains single-board
(one-cohort) cases asserting the guard never rejects and park-to-shelf routes to the board's cohort.
Optionally consider a `targetCohort ?? activeCohort` fallback in the router's cell branches as a belt-and-
suspenders for an untagged single-board cell — but cohort-tagging (change #1) is the primary mechanism;
do not let the fallback mask a missing tag.

### Success Criteria

#### Automated Verification

- Unified-router tests (incl. single-cohort cases) pass: `pnpm test`
- Single-board `handleDrop` characterization (Phase 1) still green against the unified router: `pnpm test`
- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- Drop-path integration tests pass: `pnpm test:integration`
- e2e green (both routes, full drag matrix): `pnpm test:e2e`
- Build clean: `pnpm build`

#### Manual Verification

- Single board: every drag × target in the parity matrix (course×cell/shelf, placement×cell/shelf,
  grouping×cell/shelf, bundle×cell/shelf, parked×cell/shelf) behaves exactly as before.
- Combined view: cross-cohort move guard still rejects cross-column moves; park-to-shelf under the active
  cohort still works.

**Implementation Note**: Pause for manual confirmation before the tail phases.

---

## Phase 8: Renames + `model/` folder grouping

### Overview

Resolve the naming collisions and group `model/` into sub-folders. Pure renames + moves. Fast gate.

### Changes Required

#### 1. Renames

**File**: `src/_pages/plan-detail/model/collision.ts`, `combined-drop.ts`, `combined-props.ts`, `collisions.ts`

**Intent**: Rename the singular `collision.ts` (fast-path boolean `hasIntersection`) to disambiguate it
from `collisions.ts` (full `deriveCellViolations`) — e.g. `intersects.ts`. Rename `combined-drop.ts`
(drop router) and `combined-props.ts` (SSR prop assembly) for intent. Drop the `cellKey` re-export from
`collisions.ts`; import it from its leaf `cell-key.ts` (update `CombinedPlannerBoard`/`PlannerGrid`/etc.).

**Contract**: All importers updated to the new names/leaf import. Behavior identical. Avoid a folder name
that collides with its dominant export (steiger `fsd/repetitive-naming`).

#### 2. `model/` sub-folders

**File**: `src/_pages/plan-detail/model/**`

**Intent**: Group the flat `model/` into concept folders, mirroring the existing `model/constraints/`:
`collision/` (collisions, intersects, cell-occupants, cell-tone, cell-key, constraints/),
`grouping/` (grouping, enumerate, compute-groupings, score, palette-view, filter-groupings,
sort-groupings, leading-course-options, companion-course-options, reconcile-companion),
`placement/` (placement, placement-transitions, parked, parked-members, shelf-transitions,
duplicate-target), `cross-cohort/` (cross-cohort-index, combined-drop[renamed], combined-props[renamed],
availability-index). Hooks (`use-*.ts`) stay at `model/` root (or a `hooks/` folder). Move co-located
tests with sources.

**Contract**: Folder names distinct from any single dominant export. `pnpm steiger` passes. All intra-slice
imports remain relative; depth adjusted.

### Success Criteria

#### Automated Verification

- Structure gate clean: `pnpm steiger`
- Type gate clean (catches moved-import/rename misses): `pnpm check`
- All moved tests pass: `pnpm test`
- Lint + build clean: `pnpm lint` && `pnpm build`

#### Manual Verification

- Both routes behave identically (pure rename/move).

**Implementation Note**: Pause for manual confirmation before Phase 9.

---

## Phase 9: `api/` cleanup

### Overview

Collapse the `api/` client boilerplate and de-duplicate the placement mapper. Fast gate + api integration tests.

### Changes Required

#### 1. `callAction` for the throw-style clients

**File**: `src/_pages/plan-detail/api/placement-client.ts`, `shelf-client.ts`

**Intent**: Replace the ~8× near-identical `const {data,error} = await actions.X(args); if (error) throw …;
return data` blocks with a single generic transport helper.

**Contract**: A shared `callAction`-style helper (throw-on-error variant returning `data`, since the
optimistic reconcile needs `data` — `placement-client` stays throw-by-design per `ui-conventions.md:194,221`).
Same call signatures for the React islands.

#### 2. `grouping-client` aligns to `{ error }` + `refreshPage`

**File**: `src/_pages/plan-detail/api/grouping-client.ts`

**Intent**: The pre-blessed convention delta (`ui-conventions.md:220`): align the ad-hoc
`{ error: string | undefined }` to the `callAction` `{ error }` shape and swap `location.reload()` for
`refreshPage()`.

**Contract**: Matches the `{ error }` return contract used elsewhere; `refreshPage()` preserves URL-mirrored state.

#### 3. De-duplicate `toPlannerPlacement`

**File**: `src/_pages/plan-detail/api/load.ts`, `placements.ts`

**Intent**: `load.ts` re-inlines `mapPlacements` (≈`load.ts:297-314`) which duplicates the exported
`toPlannerPlacement` (`placements.ts:62`). Import the exported one; drop the inline copy. Optionally factor
the per-cohort fetch→map→staleness repeated by `loadPlannerData`/`loadCombinedPlannerData` into a shared helper.

**Contract**: One `toPlannerPlacement`. Loader outputs unchanged (assert via the existing api integration tests).

### Success Criteria

#### Automated Verification

- Type + lint + structure clean: `pnpm check` && `pnpm lint` && `pnpm steiger`
- Unit suite passes: `pnpm test`
- api integration tests pass: `pnpm test:integration` (load / placements / shelf / combined / adapter-parity)
- Build clean: `pnpm build`
- **Final full e2e gate green**: `pnpm test:e2e` (both routes, full matrix)

#### Manual Verification

- Grouping recompute, placement writes, shelf ops, and both loaders behave identically end-to-end.

**Implementation Note**: Final phase — confirm the full local gate + manual smoke before closing the change.

---

## Testing Strategy

### Unit Tests

- New: single-board drop resolver (Phase 1), `use-board-derivations` (Phase 1), wiring-object
  referential-stability (Phase 4), `CollapsibleEdgePanel` (Phase 3), extended `use-cohort-board-state`
  live-mutation (Phase 1).
- Extended: `combined-drop.test.ts` gains single-cohort/unified cases (Phase 7).
- Preserved: the dense pure-`model/` suite (constraints, collisions, drop-hints, transitions,
  `resolveCombinedDrop`, `assembleCombinedProps`, `parked-members`, palette filter, week/hours/score/enumerate,
  the perf + parity-oracle tables) — all must stay green through every move/rename.

### Integration Tests

- `pnpm test:integration` at Phases 5, 7, 9 (cross-cohort state, drop path, api loaders/clients).

### Manual Testing Steps

1. Single board `/plans/[id]`: place a course, move it, duplicate a bundle, lift to shelf, park a palette
   course and a grouping, place a parked bundle back, toggle week A/B, open the collision dialog, collapse/
   expand palette and shelf, hit the stale-recompute and empty-compute states.
2. Combined board `/plans/[id]/combined`: switch palette cohort (confirm switcher sits below the header),
   place into each column, attempt a cross-column move (must reject), park under each cohort, confirm a
   dp1 edit re-validates dp2 live, open the shared inspection dialog from each column.
3. Confirm no perceptible drag latency regression on either board (the <200ms budget).

## Performance Considerations

No React Compiler transform — manual memoization is load-bearing. The new shared values (the per-cohort
assembler return, the single-board `wiring` object, the `BoardShell` slot content) must be referentially
stable. The wiring fix is deliberately the spread, not Context, because `dropHints`/`hintMode` change on
every drag tick and a broad-fan-out Context value would re-render all cells against the <200ms drag budget.

## Migration Notes

No data or schema migration. Pure code refactor. Each phase is an independently reviewable commit; the tail
phases (8–9) are droppable if time-boxed without leaving the slice in a broken state.

## References

- Change identity + review findings: `context/changes/plan-detail-refactor/change.md`
- Research (codebase baseline, safety net, parity, conventions, resolved decisions):
  `context/changes/plan-detail-refactor/research.md` (the 2026-06-27 21:59 follow-up is the current
  source of truth for park parity)
- UI conventions (3 amendments land here): `context/foundation/ui-conventions.md`
- Lessons (type-gate, declarative pipelines, localStorage guard): `context/foundation/lessons.md`
- The good wiring pattern: `src/_pages/plan-detail/ui/PairedPlannerGrid.tsx:104`
- The cross-cohort cycle: `src/_pages/plan-detail/model/use-cohort-board-state.ts:16-64`
- The shared drop router: `src/_pages/plan-detail/model/combined-drop.ts:29-60`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Characterization tests for the untested board seams

#### Automated

- [x] 1.1 New resolver unit tests pass (`pnpm test`) — 965442e
- [x] 1.2 `use-board-derivations` test + extended cycle test pass (`pnpm test`) — 965442e
- [x] 1.3 Type gate clean (`pnpm check`) — 965442e
- [x] 1.4 Lint + structure clean (`pnpm lint` && `pnpm steiger`) — 965442e

#### Manual

- [ ] 1.5 Single board place/move/duplicate/lift/park/place-back behave as before via the extracted resolver

### Phase 2: `ui/` five-folder restructure

#### Automated

- [x] 2.1 Structure gate clean (`pnpm steiger`)
- [x] 2.2 Type gate clean (`pnpm check`)
- [x] 2.3 Moved co-located tests still pass (`pnpm test`)
- [x] 2.4 Lint clean (`pnpm lint`)
- [x] 2.5 Production build clean (`pnpm build`)

#### Manual

- [ ] 2.6 Both routes render and behave identically (pure file movement)

### Phase 3: Shared `CollapsibleEdgePanel` + palette-header fix

#### Automated

- [ ] 3.1 `CollapsibleEdgePanel` unit test passes (`pnpm test`)
- [ ] 3.2 Existing palette tests pass (`pnpm test`)
- [ ] 3.3 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 3.4 e2e green incl. shelf-durability / combined-view / combined-shelf-park (`pnpm test:e2e`)
- [ ] 3.5 Build clean (`pnpm build`)

#### Manual

- [ ] 3.6 Combined switcher sits below the palette header; cohort switch works in ready/stale/empty; hidden when collapsed
- [ ] 3.7 Single board palette/filter/stale/empty behave as before
- [ ] 3.8 Shelf park/place-back/pin/auto-collapse/drag-out unchanged on both routes

### Phase 4: Single-path cell-wiring → bundled object + spread

#### Automated

- [ ] 4.1 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 4.2 Unit suite passes (`pnpm test`)
- [ ] 4.3 Wiring-object referential-stability unit test passes (render twice → `toBe` identity) (`pnpm test`)
- [ ] 4.4 e2e green, single-board specs (`pnpm test:e2e`)
- [ ] 4.5 Build clean (`pnpm build`)

#### Manual

- [ ] 4.6 Single board hints/week-toggle/remove/bundle ops/inspect identical; no drag perf regression

### Phase 5: Shared per-cohort `useCohortBoardState` assembler

#### Automated

- [ ] 5.1 Cycle/identity + live-mutation tests pass (`pnpm test`)
- [ ] 5.2 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 5.3 Cross-cohort integration tests pass (`pnpm test:integration`)
- [ ] 5.4 e2e green, both routes (`pnpm test:e2e`)
- [ ] 5.5 Build clean (`pnpm build`)

#### Manual

- [ ] 5.6 Single board placement/collision/hours/hint behavior identical via the shared assembler
- [ ] 5.7 Combined view: editing one cohort re-validates the sibling live in the same interaction

### Phase 6: `BoardShell` + shared `PLUGINS`

#### Automated

- [ ] 6.1 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 6.2 Unit suite passes (`pnpm test`)
- [ ] 6.3 e2e green, both routes (`pnpm test:e2e`)
- [ ] 6.4 Build clean (`pnpm build`)

#### Manual

- [ ] 6.5 Single board empty/stale/ready, summary bar, error banner, inspect dialog identical
- [ ] 6.6 Combined dual banners, switcher header, overlay disambiguation, shared inspection dialog identical

### Phase 7: Unified drop router

#### Automated

- [ ] 7.1 Unified-router tests incl. single-cohort cases pass (`pnpm test`)
- [ ] 7.2 Single-board `handleDrop` characterization still green against the unified router (`pnpm test`)
- [ ] 7.3 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 7.4 Drop-path integration tests pass (`pnpm test:integration`)
- [ ] 7.5 e2e green, both routes full drag matrix (`pnpm test:e2e`)
- [ ] 7.6 Build clean (`pnpm build`)

#### Manual

- [ ] 7.7 Single board: every drag × target in the parity matrix behaves exactly as before
- [ ] 7.8 Combined view: cross-cohort move guard still rejects; park-to-shelf under active cohort works

### Phase 8: Renames + `model/` folder grouping

#### Automated

- [ ] 8.1 Structure gate clean (`pnpm steiger`)
- [ ] 8.2 Type gate clean (`pnpm check`)
- [ ] 8.3 All moved tests pass (`pnpm test`)
- [ ] 8.4 Lint + build clean (`pnpm lint` && `pnpm build`)

#### Manual

- [ ] 8.5 Both routes behave identically (pure rename/move)

### Phase 9: `api/` cleanup

#### Automated

- [ ] 9.1 Type + lint + structure clean (`pnpm check` && `pnpm lint` && `pnpm steiger`)
- [ ] 9.2 Unit suite passes (`pnpm test`)
- [ ] 9.3 api integration tests pass (`pnpm test:integration`)
- [ ] 9.4 Build clean (`pnpm build`)
- [ ] 9.5 Final full e2e gate green, both routes (`pnpm test:e2e`)

#### Manual

- [ ] 9.6 Grouping recompute, placement writes, shelf ops, both loaders behave identically end-to-end
