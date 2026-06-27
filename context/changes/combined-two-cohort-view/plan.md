# Combined Two-Cohort View (S-06) Implementation Plan

## Overview

Add a new, additive route `/plans/[id]/combined` that renders **one paired-column grid** — each day header spans two sub-columns (DP1 | DP2) over shared period rows — as the final two-cohort assembly stage. A plan-level shell mounts **two existing `usePlacements` instances** (one per cohort) and derives each cohort's cross-cohort teacher index from the *other* cohort's **live** placements, so editing one column re-validates the other within the sub-200 ms budget. The existing single-cohort board and route are left byte-for-byte unchanged.

## Current State Analysis

The single-cohort board is mature and the enriched constraint core (co-teaching S-02, bi-weekly S-03, symmetric cross-cohort occupancy S-04, first-class bundles S-05, holding shelf S-07) is already built and tested. Key facts that make this slice additive rather than a core rewrite (from `research.md`):

- The cross-cohort index is an **injected parameter** everywhere it is consumed — `deriveCellViolations(..., occupiedByTeacher = EMPTY_CROSS_COHORT_INDEX)` (`src/_pages/plan-detail/model/collisions.ts:41`) and `usePlacements({ crossCohortIndex })` (`src/_pages/plan-detail/model/use-placements.ts:111`, consumed only at `:187` inside `duplicateBundle`). `usePlacements` reads it **reactively** (fresh each render), so a parent can feed a live, sibling-derived index.
- The pure transition core (`placement-transitions.ts`, `shelf-transitions.ts`) is **cohort-agnostic** and reused verbatim. Every `usePlacements` RPC already threads `cohort`, so two instances write to disjoint rows with no new plumbing.
- Drag IDs are **not** cohort-scoped today: `SlotCell` registers `useDroppable({ id: cellKey(day,period) })` (`src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:157`) and a bundle draggable `id: bundle:${cellKey}` (`:165`); `cellKey = "${day}:${period}"` (`src/_pages/plan-detail/model/cell-key.ts:10`). The shelf droppable is the literal `"shelf"` (`src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx:46`). Two cohorts in one `DragDropProvider` would collide.
- A documented trap forbids making `SlotCell`/`cellKey` globally cohort-aware (`context/archive/2026-06-22-cohort-switching/research.md:147`) — it would break the two-column render and ripple into the collision-map keys. Cohort must be injected at a per-column wrapper / opt-in prop.
- The loader `loadPlannerData` (`src/_pages/plan-detail/api/load.ts:31`) is **asymmetric**: full editable data for the active cohort, a read-only flat occupancy projection (`projectSiblingOccupancy`, `:162`) for the sibling.
- Palette + staleness already shipped per-cohort (`PlannerPalette.tsx`, `GroupingStalePanel.tsx`, `palette-view.ts`); the shelf is already per-cohort at the data layer (`shelf_bundles.cohort`). Both are presentation-composition for this slice, not new logic.
- The `WeekToggle` is already compact (~40px) and ships unchanged.
- A waiting `it.todo` parity test exists at `collision-parity.test.ts:395`.

## Desired End State

From an existing plan, an author clicks a **Combined view** toggle on the board header and lands on `/plans/[id]/combined`. They see DP1 and DP2 interleaved under each day, both columns fully editable with the complete operation set (palette placement, move, bundle move/remove/duplicate, ungroup, single-course move, week A/B, lift-to-shelf, place-back). Every placement validates live against students, both teachers of a co-taught course, week-aware fortnightly overlap, availability, and cross-cohort teacher occupancy — across both columns at once — within the sub-200 ms budget. A cross-cohort teacher clash is visible on **adjacent** cells; a drag that would land on the wrong cohort's cell is guarded (sibling cells dim during the drag and the drop is rejected). The single-cohort boards continue to work exactly as before.

Verify: the combined route assembles a collision-free DP1|DP2 plan (US-01); the `collision-parity` S-06 case passes; integration tests confirm cross-cohort place/move/guard; an e2e happy-path passes; the informational perf measurement stays within budget; `/verify` is green.

### Key Discoveries:

- Injected-index seam: `collisions.ts:41`, `use-placements.ts:111,:187` — live index is a pure plumbing change, not a core change.
- Reactive index read in `usePlacements` (only `placements`/`parkedBundles` are ref-captured) — a parent-fed live index reaches `duplicateBundle` and the derivation hooks.
- Memo levers: `useCrossCohortIndex`/`useCollisions`/`useDragHints` (`PlannerBoard.tsx:301-341`) all key on `occupiedByTeacher`; a fresh Map identity forces synchronous re-validation.
- `projectSiblingOccupancy` (`load.ts:162`) is server-only and keyed on snake_case DB rows — needs a model-layer twin for in-memory `LocalPlacement[]`.
- Board-only constraints (`teacher-availability`, `cross-cohort-teacher`) omit `test` and never enter the drag fast path (`constraints/*.ts:8,:13`); the drag path mirrors them explicitly (`drop-hints.ts:104-106,210-221`).
- Route/page pattern to mirror: `src/pages/plans/[id]/index.astro` + `PlanDetailPage.astro` under `SidebarLayout ... fullWidth`.

## What We're NOT Doing

- **Not** changing the single-cohort `PlannerBoard.tsx`'s **behavior or render**, or `src/pages/plans/[id]/index.astro` (the `?cohort=` + `CohortSwitcher` remount path) — the combined view is a new sibling. (Phase 3 §1 does a **behavior-preserving** extraction of `PlannerBoard`'s private derivation hooks into a shared `model/` module that both boards import; the single board renders identically.)
- **Not** refactoring `usePlacements` into a `Record<Cohort, state>` reducer — we mount it twice and keep its test suite intact. **Deliberate deviation from change.md D2 / research.md D2's "single orchestrator (scalar `cohort` → state key)" recommendation:** two instances preserve the hook + its tests at a smaller diff; the single `DragDropProvider` (D3) still gives S-08 one op-log home (the shell observes both hooks); and the only cost — a one-batched-render staleness window on the *sibling* term of each cohort's index — is unobservable (argued in Critical Implementation Details).
- **Not** changing `cellKey`, the collision-map keys, or the pure constraint core.
- **Not** adding any schema/migration — the loader reads existing tables; both cohorts' full placements + shelves already exist.
- **Not** implementing bundle **"replace"** (FR-009) — it is unbuilt today (deferred at S-05) and stays out; the combined view offers the operations that exist now.
- **Not** making the recommendation enumeration more week-aware (belongs to S-03; PRD defers it).
- **Not** adding a side-by-side (two separate grids) layout — paired-column is the locked layout.
- **Not** wiring the perf check as a hard CI gate (per `test-plan.md:96-103`).

## Implementation Approach

Build additively in five phases. Phase 1 lays non-breaking seams (a model-layer projection helper + opt-in cohort scoping on drag payloads). Phase 2 adds the symmetric loader and the route scaffold. Phase 3 builds the orchestrating shell + paired-column grid (the working board). Phase 4 composes the toggle palette and shared shelf. Phase 5 hardens with the parity test, integration/e2e, perf, and housekeeping. Each phase reuses leaf components (`SlotCell`, `PlannerPalette`, `ShelfDrawer`, `ParkedBundleCard`, `WeekToggle`) and the pure core unchanged.

## Critical Implementation Details

- **Live cross-index sequencing (state-ordering, load-bearing).** In the shell, both `usePlacements` instances must exist before either cross-index can be derived from the other's live `placements`. Resolve the cycle by: (1) call `usePlacements` for dp1 and dp2; (2) `useMemo` each cohort's `CrossCohortIndex` from the *other's* committed **and pending** placements via the new `projectFromPlacements` + `buildCrossCohortIndex`; (3) feed the live index to that cohort's `useCollisions`/`useDragHints` (where validation + hints actually consume it). The index passed into each `usePlacements` arg (used only by `duplicateBundle`) may be at most one batched-render stale for the *sibling* occupancy term — unobservable, because placement mutations and their re-render are batched before any user `duplicate` action, and `duplicateBundle` re-reads its own cohort's `placementsRef` live. Seed both indices from the SSR `crossCohortOccupancy` props on first render.
- **Cohort-scoping the drag id only, not the collision key.** The opt-in `cohort` prop prefixes the dnd-kit droppable/draggable *id* and adds `cohort` to the drag payload. It must NOT alter `cellKey` used for the per-cohort collision/hint maps — each column keeps its own `Map` keyed by `"${day}:${period}"`. This keeps the constraint core and the single-cohort board untouched.
- **Guard placement is on relocating drags only.** `course`/`grouping` drags originate from the (cohort-scoped) palette and simply adopt the target cell's cohort. The cross-cohort move guard (`if source.cohort !== target.cohort: reject`) applies to `placement`, `bundle`, and `parked` drags.

---

## Phase 1: Foundational seams

### Overview

Introduce a model-layer projection that can build a cross-cohort index from in-memory placements, and make drag identity opt-in cohort-scoped — both additive, with the single-cohort board behaving exactly as before.

### Changes Required:

#### 1. Model-layer occupancy projection

**File**: `src/_pages/plan-detail/model/cross-cohort-index.ts`

**Intent**: Add a pure `projectFromPlacements` that turns an in-memory placement array into `SiblingOccupancyCell[]`, so the combined shell can build a live index from another column's state (not just the SSR snapshot). Refactor the server-side `projectSiblingOccupancy` (`load.ts:162`) to delegate to it, removing duplication.

**Contract**: `projectFromPlacements(placements: { courseId: string; day: number; period: number; week: PlacementWeek }[], teacherKeysByCourseId: Map<string, string[]>): SiblingOccupancyCell[]` — co-teacher-expands each placement to one cell per `teacherKey`, skipping courses absent from the map. `load.ts`'s `projectSiblingOccupancy` becomes a thin adapter mapping snake_case rows + sibling catalog into this call. Existing `buildCrossCohortIndex` and `SiblingOccupancyCell` are unchanged.

#### 2. Opt-in cohort field on drag/drop payloads

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Allow drag payloads and cell drop-targets to carry an optional cohort so a shared drop handler can route and guard by cohort, without affecting single-cohort drags where the field is absent.

**Contract**: Add optional `cohort?: Cohort` to `CellData`, `PlacementDrag`, `BundleDrag`, and `ParkedDrag`. `CourseDrag`/`GroupDrag` stay cohort-free (they adopt the target cell's cohort). No field is required; omission preserves today's shape.

#### 3. Opt-in cohort scoping in the cell DnD registration

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx`

**Intent**: When a `cohort` prop is present, namespace the droppable and bundle-draggable ids and stamp `cohort` into their `data`; when absent, keep today's `cellKey`-only ids. The cell's collision/visual rendering is unchanged.

**Contract**: `SlotCell` gains optional `cohort?: Cohort`. In `useCellDnd`, when `cohort` is set, droppable `id = ${cohort}:${cellKey(day,period)}` with `data: { day, period, cohort }`, and the bundle draggable `id = bundle:${cohort}:${cellKey(day,period)}` with `data: { kind:"bundle", day, period, cohort }`. `cellKey` itself is NOT modified. Single-cohort callers pass no `cohort`.

#### 4. Opt-in cohort on the placement chip drag

**File**: `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx`

**Intent**: Carry the column's cohort on the single-placement drag so cross-cohort single-course moves are guarded.

**Contract**: Accept an optional `cohort?: Cohort` and include it in the `PlacementDrag` data when present.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Lint + structure pass: `pnpm lint` and `pnpm steiger`
- Unit tests pass, including new `projectFromPlacements` cases (co-teacher expansion, missing-course skip, week fidelity): `pnpm test`
- Existing `use-placements` and `collision-parity` suites still green (no single-cohort regression)

#### Manual Verification:

- The single-cohort board still drags/drops/parks correctly (cohort prop absent → unchanged ids)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Symmetric loader + route scaffold

### Overview

Add a loader that returns both cohorts as fully-editable `PlannerBoardProps` (each cross-index derived from the other's full placements, fetched once) and a new route that mounts the combined island and is reachable from a header toggle.

### Changes Required:

#### 1. Symmetric combined loader

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Add `loadCombinedPlannerData(supabase, id)` that loads both cohorts once and builds each cohort's cross-cohort occupancy from the *other* cohort's full placements + catalog — no redundant read-only sibling query.

**Contract**: `loadCombinedPlannerData(supabase, id): Promise<Result<{ planName: string; dp1: PlannerBoardProps; dp2: PlannerBoardProps }>>`. Plan lookup once → `{ days, periods }`. One `Promise.all`: per cohort — `course_groupings`(+members), full `placements` (`id, course_id, day, period, week, bundle_id`), `shelf_bundles`(+courses), `loadCohortCourses`; plus `teacher_availability` once (cohort-independent). For each cohort, `crossCohortOccupancy = projectFromPlacements(otherCohortPlacements, teacherKeysFromOtherCatalog)`. Resolve `teacherNames`/`studentNames` from the **union** of both catalogs. Compute `stale` per cohort (guarded by its groupings count). Each `dp1`/`dp2` block is the exact existing `PlannerBoardProps` shape so the column consumes it unchanged. Reuse the existing guards (`not-found`/`unavailable`) and `assertNoQueryErrors`.

#### 2. Combined route + page wrapper

**File**: `src/pages/plans/[id]/combined.astro` (new) and `src/_pages/plan-detail/ui/PlanDetailCombinedPage.astro` (new)

**Intent**: Mirror `index.astro` + `PlanDetailPage.astro` but without a `?cohort=` param; call the combined loader and mount the combined island under the full-width layout.

**Contract**: `combined.astro` validates the plan id, calls `loadCombinedPlannerData`, sets 404/503 on failure, reads `parsePaletteCollapsed` cookie, and renders `<SidebarLayout title plan fullWidth>` wrapping `PlanDetailCombinedPage`. The page wrapper mounts `<CombinedPlannerBoard {...} client:load />` (the island built in Phase 3); until then it may render a minimal both-cohorts placeholder to validate loading. Auth is covered by the existing deny-by-default middleware (no allowlist change).

#### 3. Combined-view entry toggle

**File**: `src/_pages/plan-detail/ui/CohortSwitcher.tsx` (or a small sibling in `BoardHeader.tsx`)

**Intent**: Add a "Combined view" control beside the existing cohort segments on the board header, and a "back to single cohort" return affordance on the combined view.

**Contract**: A link to `/plans/${planId}/combined` rendered next to `CohortSwitcher` in `BoardHeader`; on the combined page, a reciprocal link back to `/plans/${planId}?cohort=dp1`. Token-based styling only (no palette/literal colors — see lessons).

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger` pass
- Loader unit/contract test: both cohorts returned fully-editable; each `crossCohortOccupancy` derives from the other's placements; names are the union; `stale` per cohort — `pnpm test`
- `pnpm build` stays clean (Workers runtime; no Node-only APIs)

#### Manual Verification:

- Navigating to `/plans/[id]/combined` loads without error and shows both cohorts' data
- The header "Combined view" toggle and the return link navigate correctly
- The single-cohort route is unaffected

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Orchestrator shell + paired-column grid

### Overview

Build the working combined board: a shell with one `DragDropProvider`, two `usePlacements` instances, live cross-index wiring, a cohort-routed drop handler with the cross-cohort guard, shared overlay/dialog, and the interleaved paired-column grid that reuses `SlotCell`.

### Changes Required:

#### 1. Extract the shared per-cohort derivation hooks into `model/`

**File**: `src/_pages/plan-detail/model/use-board-derivations.ts` (new); `src/_pages/plan-detail/ui/PlannerBoard.tsx` (behavior-preserving)

**Intent**: The per-cohort derivation hooks the combined shell needs are today **private module-scoped functions inside `PlannerBoard.tsx`** (`useCrossCohortIndex`, `useCollisions`, `useDragHints`, `useHours`, `useCollisionInspection`, plus the `useCatalogById`/`useAvailabilityIndex` memos — `PlannerBoard.tsx:291-457`). Lift the pure-derivation set into a shared `model/` `.ts` module so both `PlannerBoard` and the new `useCohortBoardState` import them from one place — no duplication, no drift. They are framework-light compositions of existing model functions (`.ts`, not `.tsx`, per the JSX-only rule).

**Contract**: Move `useCrossCohortIndex`, `useCollisions`, `useDragHints`, `useHours`, `useCollisionInspection`, `useCatalogById`, `useAvailabilityIndex` verbatim into `use-board-derivations.ts` and re-import them in `PlannerBoard.tsx`. This is a **behavior-preserving** refactor — `PlannerBoard` renders identically (same hooks, now imported rather than redefined). The UI-disclosure/persistence hooks (`useHintMode`, `useShelfDisclosure`, `usePaletteDisclosure`) stay in the UI layer and are NOT extracted: the combined shell owns them as single, shell-level instances (§3), so the per-cohort hook never needs them.

#### 2. Per-cohort state composition hook

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts` (new)

**Intent**: Encapsulate one cohort's derived board state by composing the extracted derivation hooks (§1) + `usePlacements`, so the shell can call it twice without duplicating wiring.

**Contract**: `useCohortBoardState(props: PlannerBoardProps, crossCohortIndex: CrossCohortIndex)` returns the column's `placements`, `parkedBundles`, `collisions`, `dropHints` + drag-hint controls, `hours`, exploded-cell state, an inspection request (raised to the shell, which owns the single active inspection — §3), the per-cohort `lastDuplicated` (for the grid's duplicate pulse), error, and the full action set from `usePlacements`. Internally calls `usePlacements` (passing the live `crossCohortIndex`), then the §1 derivation hooks (`useCollisions`, `useDragHints`, `useHours`, `useCollisionInspection`, `useCatalogById`, `useAvailabilityIndex`) plus `useExplodedCells`. It does NOT own hint-mode or shelf/palette disclosure — those are shell-level singletons (§3). `PlannerBoard` is not rewired onto this hook in this slice; it just imports the same §1 derivations.

#### 3. Combined board shell

**File**: `src/_pages/plan-detail/ui/CombinedPlannerBoard.tsx` (new)

**Intent**: Own the single drag context, both cohorts' state, the live cross-index derivation, the cohort-routed drop dispatch + guard, the shared overlay/dialog, and the **shell-level UI singletons** (one `useHintMode`, one `useShelfDisclosure`, one `usePaletteDisclosure` for the whole combined view).

**Contract**: Props `{ planName, planId, days, periods, dp1: PlannerBoardProps, dp2: PlannerBoardProps, paletteCollapsed }`. Calls `useCohortBoardState` for each cohort; derives `dp1Index`/`dp2Index` via `useMemo` over the *other* column's committed+pending placements (`projectFromPlacements` → `buildCrossCohortIndex`), seeded from the SSR `crossCohortOccupancy` (see Critical Implementation Details). Renders one `<DragDropProvider plugins onDragStart onDragEnd>` with a `handleDrop` that reads `target.data.cohort` (and source cohort), selects `actionsByCohort[cohort]`, runs the existing `switch(kind)` dispatch, and **rejects** `placement`/`bundle`/`parked` drags whose source cohort ≠ target cohort. Hosts a shared `GroupDragOverlay` (names = union) and a single `CollisionDetailsDialog`: the shell owns the **one** active inspection `{ cohort, target }` — each column raises an inspect request, the shell selects which is open (opening one closes the other). Shelf park routes by **source** cohort; place-back routes by `ParkedDrag.cohort`.

#### 4. Shared single-cell host + paired-column grid

**File**: `src/_pages/plan-detail/ui/slot-cell/SlotCellHost.tsx` (new); `src/_pages/plan-detail/ui/PairedPlannerGrid.tsx` (new); `src/_pages/plan-detail/ui/PlannerGrid.tsx` (behavior-preserving)

**Intent**: Render one grid with day headers spanning two cohort sub-columns over shared period rows, interleaving each cohort's cells. So the per-cell plumbing isn't copy-pasted, first extract a `SlotCellHost` that wraps `SlotCell` with its derivation/wiring (dropHint lookup + `hintActive`, `bundled`, the `justDuplicated` pulse key, and the `CellWiring` fan-out) — the logic currently inline in `PlannerGrid`/`PeriodRow` (`PlannerGrid.tsx:152-163`). `PairedPlannerGrid` then owns only the column-spanning header + the DP1/DP2 interleave, not the cell internals.

**Contract**: `SlotCellHost` takes one cohort's `(day, period)` slice — occupants, `collisions`, `dropHints`, `justDuplicated`, exploded state, `CellWiring` — and an optional `cohort`, and renders the `SlotCell` exactly as `PeriodRow` does today; `PlannerGrid`'s `PeriodRow` is refactored to render `SlotCellHost` (**behavior-preserving** — the single grid renders identically). `PairedPlannerGrid` props: both cohorts' `placements`/`collisions`/`dropHints`/`CellWiring`/`justDuplicated`/exploded state, plus `days`/`periods`/`names`. CSS grid `gridTemplateColumns: auto repeat(${days}, minmax(7rem,1fr) minmax(7rem,1fr))`; a header row where each `dayLabel` spans 2 sub-columns with DP1/DP2 sub-labels; per period row, for each day emit the DP1 `SlotCellHost` then the DP2 `SlotCellHost`, each with `cohort` set so ids are namespaced. Reuses `groupCellOccupants`, `isBundled`, `dayLabel`, `periodLabel`, `WeekToggle`, `PlacedChip` unchanged.

#### 5. Sibling-cohort dimming during drag

**File**: `src/_pages/plan-detail/ui/PairedPlannerGrid.tsx` / `slot-cell/SlotCell.tsx`

**Intent**: While a drag is active, visually recede / mark the non-source cohort's cells as non-targets so accidental cross-cohort drops on adjacent cells are prevented.

**Contract**: Derive the active drag's source cohort from `handleDragStart`; pass a `dimmed`/`nonTarget` flag to the sibling column's cells for the drag's duration (reuse the drop-hint rendering path; token-based styling). Cleared on drop/cancel.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger` pass
- Unit tests for the cohort-routing + guard logic (cross-cohort `placement`/`bundle`/`parked` drops rejected; same-cohort dispatched) and for live-index recompute (editing one cohort changes the other's `occupiedByTeacher` identity): `pnpm test`
- `pnpm build` clean

#### Manual Verification:

- Placing/moving in DP1 immediately re-validates DP2 (cross-cohort teacher clash flags on the adjacent cell)
- Dragging a bundle from DP1 cannot drop on a DP2 cell; sibling cells dim during the drag
- All editing ops work in both columns (place, move, bundle move/remove/duplicate, ungroup, single-course move, week A/B)
- Single-cohort board unaffected

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 4: Toggle palette + shared tagged shelf

### Overview

Compose the two per-cohort palettes behind a single DP1/DP2 toggle (compact-first), and merge both cohorts' parked bundles into one shared, cohort-tagged shelf drawer with correctly routed place-back.

### Changes Required:

#### 1. Single toggle palette

**File**: `src/_pages/plan-detail/ui/CombinedPalettePanel.tsx` (new)

**Intent**: Render one palette panel that switches which cohort's grouping set (and empty/stale/ready view) is shown via a DP1/DP2 toggle; the active cohort drives the sibling-cell dimming used by the guard.

**Contract**: Holds `activeCohort` state. For the active cohort, reuse `resolvePaletteView` to pick `ComputeGroupingsEmptyState` / `GroupingStalePanel` / `PlannerPalette`, passing that cohort's `groupings`/`names`/`hours` and `{ planId, cohort }`. Reuses `usePaletteFilter` per cohort and the collapse disclosure (`usePaletteDisclosure`); **default collapsed** in the combined view (compact-first), honoring the saved cookie when present. Switching the toggle sets the active cohort consumed by the shell's dimming.

#### 2. Shared tagged shelf drawer

**File**: `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx` and `ParkedBundleCard.tsx`

**Intent**: Show both cohorts' parked bundles in one drawer, each card tagged DP1/DP2, with place-back routed to the card's own cohort.

**Contract**: The shell merges `dp1.parkedBundles` (tagged dp1) + `dp2.parkedBundles` (tagged dp2) into one list passed to a single `ShelfDrawer`. `ParkedBundleCard` accepts the card's `cohort`, renders a DP1/DP2 badge, and includes `cohort` in its `ParkedDrag` data; `onRemove` routes to that cohort's `removeParked`. The shelf droppable stays the single `"shelf"` id (park routes by source cohort). `useShelfDisclosure` reused; **default unpinned/closed** in the combined view.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm steiger` pass
- Unit test: place-back of a tagged parked card routes to the correct cohort; park routes by source cohort — `pnpm test`
- `pnpm build` clean

#### Manual Verification:

- Toggling the palette swaps between DP1 and DP2 recommendations; dragging a grouping places into the matching cohort
- Parking from either cohort shows a correctly tagged card in the shared drawer; dragging it back lands in its own cohort and is rejected on the other
- Palette collapsed and shelf closed by default; the wide grid has room

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 5: Verification & hardening

### Overview

Lock correctness and the perf guardrail, add e2e coverage, and clear the two housekeeping items.

### Changes Required:

#### 1. S-06 collision-parity case

**File**: `src/_pages/plan-detail/model/collision-parity.test.ts`

**Intent**: Replace the `it.todo` at `:395` with real cases proving co-teaching + bi-weekly + cross-cohort interact with no false-positive "valid", through both the committed (`deriveCellViolations`) and drag (`deriveDropHints`) boundaries.

**Contract**: Add `ParityCase` rows covering: a co-taught course whose teacher is occupied in the sibling cohort, same week → blocked; opposite week → allowed; weekly vs fortnightly clash → blocked; asserted symmetrically (DP1↔DP2) via the existing `assertCommitted`/`assertDrag` harness.

#### 2. Cross-cohort integration tests

**File**: `src/_pages/plan-detail/api/*.integration.test.ts` (extend the existing harness)

**Intent**: Verify, against local Supabase, that placing/moving across the two cohorts behaves and that cross-cohort moves are not silently persisted.

**Contract**: Using the `createPlan` (aliased `createFactoryPlan` in existing integration tests) / `seedPlanCatalog` builders and `teardown` pattern, seed a shared teacher across cohorts; assert symmetric cross-cohort occupancy on commit, and that a within-cohort move succeeds while a cross-cohort relocation is rejected at the handler layer.

#### 3. Combined-view e2e happy path

**File**: `e2e/specs/combined-view.spec.ts` (new)

**Intent**: Drive the combined route end-to-end on the workerd preview, asserting two-cohort assembly, a visible cross-cohort clash, and the guard.

**Contract**: Reuse `e2e/support` helpers (`gotoStable`, `computeGroupings`, `placeFromPalette`, role-based locators, `deletePlan` teardown, `storageState` auth). Navigate via the header toggle to `/plans/[id]/combined`, place into both cohorts, assert a cross-cohort collision is flagged on adjacent cells, and assert a cross-column bundle drag does not move.

#### 4. Informational perf measurement

**File**: `src/_pages/plan-detail/model/collisions.perf.test.ts` (new)

**Intent**: Measure the pure derivation cost on a realistic both-cohort dataset to guard the sub-200 ms budget, without a flaky wall-clock CI gate (per `test-plan.md:96-103`).

**Contract**: Wrap `deriveCellViolations` + `deriveDropHints` over a full two-cohort placement set in `performance.now()`; log the timing and assert a generous ceiling (e.g. well under budget) as a regression signal. Not wired as a hard CI gate.

#### 5. Housekeeping

**File**: `src/_pages/plan-detail/ui/ComputeGroupingsEmptyState.tsx` and `context/foundation/roadmap.md`

**Intent**: Correct the stale "re-compute and staleness UI are S-06" comment (that work already shipped), and fix the roadmap S-04 status drift (detail says `proposed`; it is done/archived).

**Contract**: Edit the doc-comment text; update the S-04 slice `Status:` and Backlog/Streams rows to reflect `done`, and add the missing S-04 entry to the Done log.

### Success Criteria:

#### Automated Verification:

- `collision-parity` S-06 cases pass: `pnpm test`
- Integration suite passes: `pnpm test:integration`
- e2e suite passes: `pnpm test:e2e`
- Perf measurement runs and stays within the asserted ceiling
- Full local CI gate green via the `/verify` skill (`pnpm check`/`lint`/`steiger`/`audit`/`test`/`build`)

#### Manual Verification:

- Sub-200 ms feel confirmed in DevTools during a drag in the combined view (both columns live)
- Stale comment and roadmap status read correctly

**Implementation Note**: Final phase — confirm the full gate and US-01 acceptance before closing.

---

## Testing Strategy

### Unit Tests:

- `projectFromPlacements`: co-teacher expansion, missing-course skip, week fidelity (Phase 1).
- Loader contract: symmetric both-cohort output, cross-index from the other's placements, union names, per-cohort stale (Phase 2).
- Cohort-routing + cross-cohort guard; live-index recompute identity change on edit (Phase 3).
- Shelf place-back/park cohort routing (Phase 4).
- `collision-parity` S-06: co-teaching × bi-weekly × cross-cohort, no false-positive valid, both boundaries, symmetric (Phase 5).

### Integration Tests:

- Cross-cohort symmetric occupancy on commit; within-cohort move succeeds, cross-cohort relocation rejected (Phase 5), via the local-Supabase factory/teardown harness.

### Manual Testing Steps:

1. Open `/plans/[id]/combined`; confirm both cohorts interleave under each day.
2. Place a shared teacher in DP1 and the same slot/week in DP2 → both flag a cross-cohort clash on adjacent cells; opposite weeks do not.
3. Drag a DP1 bundle toward a DP2 cell → sibling cells dim and the drop is rejected.
4. Park from each cohort → tagged cards in one drawer; drag each back into its own cohort.
5. Confirm the single-cohort boards still work unchanged.

## Performance Considerations

The drag fast path uses only the context-free constraints; `teacher-availability` and `cross-cohort-teacher` are board-only and mirrored explicitly in `deriveDropHints`. Each cross-index is rebuilt with `useMemo` only when the *other* cohort's placements change, so per-drag cost stays bounded by one column's size. The informational perf test (Phase 5) guards the pure derivation; manual DevTools verification confirms the end-to-end feel. No hard CI perf gate (anti-flakiness convention).

## Migration Notes

None. No schema or migration changes — the combined loader reads existing tables (both cohorts' full placements, shelves, catalogs already exist). The single-cohort board, route, and constraint core are untouched, so there is nothing to roll back beyond reverting the additive files.

## References

- Research: `context/changes/combined-two-cohort-view/research.md`
- Locked decisions (D1–D6): `context/changes/combined-two-cohort-view/change.md`
- Injected-index seam: `src/_pages/plan-detail/model/collisions.ts:41`, `src/_pages/plan-detail/model/use-placements.ts:111,:187`
- Memo levers: `src/_pages/plan-detail/ui/PlannerBoard.tsx:301-341`
- Server projection to generalize: `src/_pages/plan-detail/api/load.ts:162`
- Drag ids/payloads: `src/_pages/plan-detail/ui/slot-cell/SlotCell.tsx:157,165`, `src/_pages/plan-detail/model/drag.ts`
- Route/page pattern: `src/pages/plans/[id]/index.astro`, `src/_pages/plan-detail/ui/PlanDetailPage.astro`
- Parity harness + S-06 todo: `src/_pages/plan-detail/model/collision-parity.test.ts:395`
- Forward-compat trap: `context/archive/2026-06-22-cohort-switching/research.md:147`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Foundational seams

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — 7b4d9ed
- [x] 1.2 Lint + structure pass: `pnpm lint` and `pnpm steiger` — 7b4d9ed
- [x] 1.3 Unit tests pass, including new `projectFromPlacements` cases: `pnpm test` — 7b4d9ed
- [x] 1.4 Existing `use-placements` and `collision-parity` suites still green — 7b4d9ed

#### Manual

- [x] 1.5 Single-cohort board still drags/drops/parks correctly (cohort prop absent → unchanged) — 7b4d9ed

### Phase 2: Symmetric loader + route scaffold

#### Automated

- [x] 2.1 `pnpm check`, `pnpm lint`, `pnpm steiger` pass — 0355ef8
- [x] 2.2 Loader unit/contract test passes (both cohorts editable; cross-index from other; union names; per-cohort stale): `pnpm test` — 0355ef8
- [x] 2.3 `pnpm build` stays clean — 0355ef8

#### Manual

- [x] 2.4 `/plans/[id]/combined` loads without error and shows both cohorts' data — 0355ef8
- [x] 2.5 Header "Combined view" toggle and return link navigate correctly — 0355ef8
- [x] 2.6 Single-cohort route unaffected — 0355ef8

### Phase 3: Orchestrator shell + paired-column grid

#### Automated

- [x] 3.1 `pnpm check`, `pnpm lint`, `pnpm steiger` pass — eccf234
- [x] 3.2 Unit tests for cohort-routing + guard and live-index recompute pass: `pnpm test` — eccf234
- [x] 3.3 `pnpm build` clean — eccf234

#### Manual

- [x] 3.4 Editing DP1 immediately re-validates DP2 (cross-cohort clash on adjacent cell) — f7e8a90
- [x] 3.5 Cross-cohort bundle drop rejected; sibling cells dim during drag — f7e8a90
- [x] 3.6 Full editing op set works in both columns — eccf234
- [x] 3.7 Single-cohort board unaffected — eccf234

### Phase 4: Toggle palette + shared tagged shelf

#### Automated

- [x] 4.1 `pnpm check`, `pnpm lint`, `pnpm steiger` pass — a264372
- [x] 4.2 Unit test: place-back/park cohort routing correct: `pnpm test` — a264372
- [x] 4.3 `pnpm build` clean — a264372

#### Manual

- [x] 4.4 Palette toggle swaps DP1/DP2 recommendations; grouping places into matching cohort — a264372
- [x] 4.5 Parked cards tagged and route back to their own cohort; rejected on the other — a264372
- [x] 4.6 Palette collapsed + shelf closed by default; wide grid has room — a264372

### Phase 5: Verification & hardening

#### Automated

- [x] 5.1 `collision-parity` S-06 cases pass: `pnpm test` — f7e8a90
- [x] 5.2 Integration suite passes: `pnpm test:integration` — f7e8a90
- [x] 5.3 e2e suite passes: `pnpm test:e2e` — f7e8a90
- [x] 5.4 Perf measurement runs within the asserted ceiling — f7e8a90
- [x] 5.5 Full local CI gate green via `/verify` — f7e8a90

#### Manual

- [x] 5.6 Sub-200 ms feel confirmed in DevTools during a combined-view drag — f7e8a90
- [x] 5.7 Stale comment and roadmap S-04 status read correctly — f7e8a90
