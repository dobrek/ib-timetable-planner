# Planner Palette UI Improvements Implementation Plan

## Overview

Two independent UI improvements to the left-edge planner palette in the `plan-detail` slice:

1. **Grouping↔bundle density parity** — bring `GroupingBox` (the palette suggestion box) and the shared `PaletteCourseChip` down to the same compact `text-xs` board-chip density that the parked bundle card, the drag ghost, and the on-board placed chip already use. This is the planned continuation of the `bundle-holding-container` change, which densified those three renderers and explicitly deferred `GroupingBox` as out-of-scope.

2. **Collapsible PlannerPalette** — mirror the right-edge `ShelfDrawer` onto the left edge so the palette collapses to a thin rail and expands back, using the house width-animation recipe. The collapsed state persists per-device via a flash-free cookie read server-side and seeded into the island's initial state.

The two sub-goals are independent and ship as separate commits.

## Current State Analysis

- **The palette is always-open and doesn't own its width.** `PlannerPalette.tsx:40` renders a bare `<aside className="flex min-h-0 flex-col gap-6">` (no border/bg) holding a `shrink-0` `GroupingFilter` header and a scrollable `GroupingBox` list. It sits in a hard `18rem` grid track (`PlannerBoard.tsx:219`, `lg:grid-cols-[18rem_minmax(0,1fr)_auto]`), so it cannot animate its width — the track owns it. There is no collapse affordance.
- **The palette's filter state is purely local.** `usePaletteFilter` (`PlannerPalette.tsx:99`) holds `leadingCourseId`/`companionCourseId`; the docstring states "nothing outside the palette reads it." Collapsing the body has **zero cross-component data effect**, and because the body stays mounted, filter selection survives a collapse/expand cycle.
- **The collapse/animate template already exists.** `ShelfDrawer.tsx:55-60` is the React-island form of the house recipe: one persistent `<aside>` that animates `w-9 ↔ w-60` via `transition-[width] duration-200 motion-reduce:transition-none overflow-hidden`, with the collapsed tab and expanded body both staying mounted and toggled by a display class (`hidden`/`flex`, `ShelfDrawer.tsx:91-96`). It mirrors `SidebarLayout`'s rail.
- **The disclosure-state pattern lives in the board.** `useShelfDisclosure` (`PlannerBoard.tsx:369-381`) owns the shelf's open/closed state; `useHintMode` (`:359-362`) owns a per-device pref via `useSyncExternalStore`. The board is the orchestrator; the drawer is presentational (`ShelfDrawer` takes `expanded` + `onExpandedChange`). The palette is *simpler* than the shelf — no auto-collapse trigger, no pin concept — so a single boolean suffices.
- **The cookie read side has a precedent.** `index.astro:9` already calls `createClient(Astro.request.headers, Astro.cookies)`, so reading `Astro.cookies` server-side is established. The prop threading path is `index.astro` → `PlanDetailPage.astro` (`Props` currently `planName` + `boardProps`) → `<PlannerBoard … client:load />`.
- **`GroupingBox` is the last chunky renderer.** It is at `px-3 py-2 text-sm` (header, `GroupingBox.tsx:58`) and `gap-2 px-2 py-1.5 text-sm` (rows, `:81`). The canonical board-chip metric is `px-1.5 py-1 text-xs gap-1 rounded-md border` (`PlacedChip.tsx:125`); `ParkedBundleCard` and the drag ghost were aligned to it in commit `4e1bc79`. The shared `PaletteCourseChip` (`:30`, `px-2 py-1.5 text-sm gap-2`) is used by both 1-member groupings (`GroupingBox.tsx:36-46`) and the filter-promoted single chip (`PlannerPalette.tsx:81`).
- **The palette is not a droppable** — only the shelf (`ShelfDrawer.tsx:46`) and slot cells (`SlotCell.tsx:157`) are. The palette is only a *source* of draggables. Collapse is a user click that cannot fire mid-drag of a palette item, so the shelf's mid-drag-reflow hazard does not even arise. The <200ms placement-validation budget is untouched (collapse is pure CSS reflow, never in the validation path).

## Desired End State

When this plan is complete:

- **Density:** the palette's grouping boxes and single-course chips read at the same compact density as everything on the board and shelf — `text-xs`, tight padding, `size-4` grip retained. A grouping box no longer looks chunkier than the bundle it becomes.
- **Collapse:** the palette can be collapsed to a thin left-edge rail showing a `Boxes` icon over the total grouping count; clicking it expands the palette. The expanded palette gains a small header strip with a `ChevronLeft` collapse button. The transition animates `w-9 ↔ w-64` (honoring `motion-reduce`), the board column reflows in step, and the collapsed/expanded choice survives a page reload (per device) with **no hydration flash**.

**Verification:** reload the plan page after collapsing → it returns collapsed, no expand-then-snap flash. Drag a grouping/chip → unaffected. `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` all clean.

### Key Discoveries:

- Mirror, don't share: `ShelfDrawer.tsx:24-35,55-60,84-102` is the exact template; copy its structure to the left edge (chevron points left, rail on the left). `context/archive/2026-06-26-bundle-holding-container/reviews/impl-review.md:67-75` (F5) deliberately kept these renderers separate on content-divergence grounds — honor that, do class edits only.
- The palette state is simpler than the shelf: no `expanded || pinned` derivation, no `useSyncExternalStore` — just `useState(initialCollapsed)` seeded from a server-read cookie, with the toggle writing the cookie client-side.
- Flash-free persistence requires the **server** to read the cookie and seed the island's initial state via a prop; the island cannot run a pre-hydration script like `SidebarLayout` does. SSR prop = first client paint, so no mismatch (`context/changes/planner-palette-ui-improvments/research.md:44`).
- `pnpm check` (`astro check`) is the only valid type-check gate (lessons.md). Never cite `pnpm build`/`pnpm lint` as a type-check.
- Cosmetic per-device prefs are cookies/localStorage, **not** Astro Actions (lessons.md: Actions are for app-data mutations). This collapse flag is the same category as `drag-hint-mode`/`shelf-pinned`.

## What We're NOT Doing

- **No shared card shell / `BundleCardShell` extraction.** Locked decision: class edits only; keep `GroupingBox`/`ParkedBundleCard`/`OverlayCard` as separate components.
- **No pin concept for the palette.** The palette never auto-collapses (no drop ever targets it), so there is no need for the shelf's pin. A single boolean.
- **No `PlanSummaryBar` opener for the palette.** Locked decision: the left-edge rail click is the only reopen control (the shelf has a summary-bar badge only because drops auto-collapse it).
- **No cross-tab sync of the collapse cookie.** A cookie has no `storage` event; acceptable for a cosmetic per-tab toggle. Note it, don't engineer around it.
- **No structural change to the grouping box or chip** beyond density (the student-coverage count and per-member hours stay — they are legitimate palette content the neutral bundle card omits).
- **No change to the shelf, overlay, or placed chip** — they are already at the target density.

## Implementation Approach

**Phase 1 (density)** is three Tailwind class edits plus assertions — self-contained, no new files, lowest risk. **Phase 2 (collapse)** clones the established disclosure pattern: a new `lib/palette-collapsed.ts` cookie helper, a server cookie read threaded as a `paletteCollapsed` prop through the two `.astro` layers, a `usePaletteDisclosure` hook in `PlannerBoard` (the orchestrator), and a `PlannerPalette` rebuilt as a presentational collapsible aside mirroring `ShelfDrawer`. The grid's first track moves from `18rem` to `auto` so the palette owns its animated width; `GroupingStalePanel` is pinned to `w-64` so the stale state stays stable in the now-`auto` track.

## Critical Implementation Details

- **Flash-free hydration is the load-bearing constraint.** The `paletteCollapsed` prop must be serialized identically on the server and the first client render: `index.astro` reads the cookie, passes the boolean down, and `usePaletteDisclosure` seeds `useState(paletteCollapsed)`. Do **not** read the cookie inside the island (that would render expanded for one frame then snap shut). Keep both the rail and the expanded body mounted and toggle by display class — never conditionally render one or the other (mirrors `ShelfDrawer.tsx:91-96`; preserves dnd-kit source elements and avoids remount-on-collapse).
- **`Secure` cookie attribute must be conditional.** Setting `Secure` unconditionally drops the cookie on `http://localhost` dev. Gate it on `location.protocol === "https:"` in the client write helper.

## Phase 1: Grouping↔Bundle Density Parity

### Overview

Bring `GroupingBox` and the shared `PaletteCourseChip` to the canonical board-chip density so a palette suggestion reads at the same compactness as the bundle/chip it becomes. Density only — no structural or content change.

### Changes Required:

#### 1. GroupingBox header + member rows

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx`

**Intent**: Shrink the header strip and the member rows from the chunky `text-sm` density to the board-chip metric, matching `ParkedBundleCard`/`PlacedChip`. Keep the skeleton, the `size-4` grip, the `font-medium` header weight, the `rounded-t-lg`/`rounded-md border` shapes, the A/B badge, and the students counter unchanged.

**Contract**:
- Header (`GroupingBox.tsx:58`): `px-3 py-2 text-sm` → `px-2 py-1.5 text-xs` (keep `gap-2 font-medium rounded-t-lg`).
- Member row (`MemberRow`, `GroupingBox.tsx:81`): `gap-2 … px-2 py-1.5 text-sm` → `gap-1 … px-1.5 py-1 text-xs` (keep `rounded-md border truncate`).

#### 2. Shared single-course chip

**File**: `src/_pages/plan-detail/ui/PaletteCourseChip.tsx`

**Intent**: Densify the shared chip so 1-member groupings and the filter-promoted single chip match the board-chip metric. Locked decision: the promoted chip densifies with the palette (it is a palette element). Keep the `size-4` grip and `shadow-xs`.

**Contract**: `gap-2 … px-2 py-1.5 text-sm` (`PaletteCourseChip.tsx:30`) → `gap-1 … px-1.5 py-1 text-xs` (keep `bg-background flex cursor-grab items-center rounded-md border shadow-xs` + hover/active classes).

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit tests pass: `pnpm test`
- Production build is clean: `pnpm build`

#### Manual Verification:

- A multi-member `GroupingBox` renders at the same density as a `ParkedBundleCard` (header text + row text visibly `text-xs`, tight padding); the `size-4` grip and students counter are intact.
- A 1-member grouping and a filter-promoted single chip render compact and identical to each other.
- No layout overflow or truncation regression in the palette list; A/B badge and hours counters still align.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Collapsible PlannerPalette

### Overview

Make the palette collapse to a thin left-edge rail and expand back, mirroring `ShelfDrawer`, with the collapsed state persisted per-device via a flash-free cookie+SSR read. The board's first grid track moves to `auto` so the palette owns its animated width.

### Changes Required:

#### 1. Cookie persistence helper

**File**: `src/_pages/plan-detail/lib/palette-collapsed.ts` (new)

**Intent**: Hold the cookie name plus a server-safe pure parse helper (shared with the Astro read) and a client-side write helper. This is the cosmetic-pref counterpart to `shelf-pinned.ts`, but cookie-backed (not localStorage) so the server can read it and seed flash-free initial state. No Astro Action (cosmetic per-device pref).

**Contract**:
- `COOKIE_NAME = "planner-palette-collapsed"`, `DEFAULT_PALETTE_COLLAPSED = false`.
- `parsePaletteCollapsed(value: string | undefined): boolean` — pure, returns `value === "true"`; safe to import server-side (no `document`/`window` at module scope).
- `writePaletteCollapsed(collapsed: boolean): void` — client-side `document.cookie` write. Attributes: `path=/plans`, `SameSite=Lax`, `max-age` ~1 year (`31536000`), and `Secure` **only** when `location.protocol === "https:"`. Guard for `typeof document === "undefined"` (no-op on server), consistent with the storage-guard idiom in `shelf-pinned.ts`.

#### 2. Server cookie read + prop threading

**File**: `src/pages/plans/[id]/index.astro`

**Intent**: Read the collapse cookie server-side and pass it as a `paletteCollapsed` prop into the page so the island can seed flash-free initial state.

**Contract**: After the existing data load, compute `paletteCollapsed` from `Astro.cookies.get(COOKIE_NAME)?.value` via `parsePaletteCollapsed` (deep import from `@/_pages/plan-detail/lib/palette-collapsed`, consistent with the file's existing deep imports into `@/_pages/plan-detail/*`). Pass `paletteCollapsed={paletteCollapsed}` to `<PlanDetailPage …>` (the success branch only; the error branch is unaffected).

**File**: `src/_pages/plan-detail/ui/PlanDetailPage.astro`

**Intent**: Forward the new prop to the island.

**Contract**: Add `paletteCollapsed: boolean` to `Props`; pass it to `<PlannerBoard {...boardProps} planName={planName} paletteCollapsed={paletteCollapsed} client:load />`.

#### 3. Disclosure state in the board orchestrator

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Own the palette's collapse state in the board (mirroring `useShelfDisclosure`/`useHintMode`), seeded from the SSR prop, writing the cookie on toggle. Keep `PlannerPalette` presentational. Move the grid's first track from fixed `18rem` to `auto` so the palette owns its width.

**Contract**:
- Extend the component prop type to `PlannerBoardProps & { planName: string; paletteCollapsed: boolean }`; destructure `paletteCollapsed`.
- Add `usePaletteDisclosure(initialCollapsed: boolean)` (newspaper order, near `useShelfDisclosure`): `const [collapsed, setCollapsed] = useState(initialCollapsed)`; expose a setter that calls `setCollapsed(next)` **and** `writePaletteCollapsed(next)`. No `useSyncExternalStore` (cookie is read once at SSR; cross-tab sync intentionally omitted).
- Pass `collapsed` + `onCollapsedChange` into `<PlannerPalette …>`.
- Grid (`PlannerBoard.tsx:219`): `lg:grid-cols-[18rem_minmax(0,1fr)_auto]` → `lg:grid-cols-[auto_minmax(0,1fr)_auto]` (board column stays `minmax(0,1fr)` and absorbs the reflow; comment at `:214-216` still holds).

#### 4. Collapsible palette aside

**File**: `src/_pages/plan-detail/ui/PlannerPalette.tsx`

**Intent**: Rebuild the aside as a presentational collapsible drawer mirroring `ShelfDrawer`: one persistent `<aside>` animating `w-9 ↔ w-64`, with a collapsed rail (`Boxes` icon + total grouping count, click-to-expand) and an expanded body (a header strip with a `ChevronLeft` collapse button, then the existing `GroupingFilter` + scrollable list). Both children stay mounted, toggled by display class. The filter and list internals are unchanged.

**Contract**:
- Props gain `collapsed: boolean` and `onCollapsedChange: (collapsed: boolean) => void`.
- Aside: `transition-[width] duration-200 motion-reduce:transition-none overflow-hidden` + `flex max-h-full min-h-0 shrink-0 flex-col`, width `collapsed ? "w-9" : "w-64"`; keep `data-slot="planner-palette"`, add `data-collapsed={collapsed}`. (No border/bg on the aside — keep the expanded look borderless as today; put the tab framing on the rail.)
- Collapsed rail: a full-height `<button data-slot="palette-expand" aria-label={`Open palette (${count} groupings)`}>` showing `<Boxes className="size-4" />` over the total count (`tabular-nums`), toggled visible by display class (`collapsed ? "flex …" : "hidden"`), `onClick` → `onCollapsedChange(false)`. Mirror `CollapsedTab`'s display-class note (`ShelfDrawer.tsx:91-96`).
- Expanded body: toggled by display class (`collapsed ? "hidden" : "flex …"`), preserving the current `gap-6` column. Add a `shrink-0` header strip above the filter: `Boxes` icon + a short label (e.g. "Groupings") + total count + an `ml-auto` `ChevronLeft` collapse button (`data-slot="palette-collapse"`, `aria-label="Collapse palette"`, `onClick` → `onCollapsedChange(true)`). Reuse a local icon-button class constant mirroring `SHELF_ICON_BUTTON` (`text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded`) — define locally, do not share (respects "mirror, don't share").
- Count source: `groupings.length` (total). The filter is internal and hidden when collapsed, so the rail/header count is the total, not the filtered `visibleGroupings`.
- Semantic tokens only; honor `motion-reduce:` verbatim.

#### 5. Stable stale-state width

**File**: `src/_pages/plan-detail/ui/GroupingStalePanel.tsx`

**Intent**: With track 1 now `auto`, the stale panel (no width today) would shrink to content width. Pin it to the expanded palette width so the column stays stable when suggestions are stale.

**Contract**: Add `w-64` to the panel's outer `<aside>` (`GroupingStalePanel.tsx:28`).

> **Decision (collapse interaction):** track 1 is a ternary (`PlannerBoard.tsx:221-225`) — `GroupingStalePanel` *replaces* `PlannerPalette` when `paletteView === "stale"`, and the collapse state is passed only to the palette. So a collapsed palette intentionally widens from the `w-9` rail to the full `w-64` stale panel when suggestions go stale, ignoring the collapse pref until recompute reloads (the panel restores the collapsed rail). This is deliberate: the stale panel carries the required Recompute CTA, which must not be hidden behind a collapsed rail. The stale panel is **not** made collapsible.

### Success Criteria:

#### Automated Verification:

- Type check passes: `pnpm check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit tests pass (including new palette collapse + cookie-parse tests): `pnpm test`
- Production build is clean: `pnpm build`

#### Manual Verification:

- Clicking `ChevronLeft` collapses the palette to a `w-9` rail showing `Boxes` + the grouping count; the board column widens in step; the animation is smooth and respects reduced-motion.
- Clicking the collapsed rail re-expands the palette to `w-64` with the filter + list intact (filter selection preserved across the cycle).
- **Reload after collapsing → the palette returns collapsed with no expand-then-snap flash** (the load-bearing flash-free check). Reload after expanding → returns expanded.
- Dragging a grouping/chip out of the palette still works; collapse cannot be triggered mid-drag.
- The stale-suggestions state renders at a stable `w-64` width (no jump vs. before).
- In dev (`http://localhost`) the cookie is actually set (i.e. `Secure` did not suppress it); reload persists.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- **`palette-collapsed.test.ts`** (new, beside the lib): `parsePaletteCollapsed("true") === true`; `"false"`, `undefined`, and any other value → `false`. (Guards the SSR↔client contract; `shelf-pinned.ts` has no test, but this parse is shared across the server/client boundary, so it is worth pinning.)
- **`PlannerPalette.test.tsx`** (extend the existing file): render `<PlannerPalette>` inside a `<DragDropProvider>` (the mounted `GroupingBox`/`PaletteCourseChip` children call `useDraggable`).
  - `collapsed=true` → the `palette-expand` rail button is present (`aria-label` "Open palette (N groupings)"); clicking it calls `onCollapsedChange(false)`.
  - `collapsed=false` → the `palette-collapse` button is present; clicking it calls `onCollapsedChange(true)`; the `GroupingFilter` is rendered.
  - The rail/header count equals `groupings.length` (total), not the filtered count.

### Integration Tests:

- None required — no Supabase or Action surface is touched (the collapse flag is a client cookie; the SSR read is a pure cookie parse).

### Manual Testing Steps:

1. Open a plan with several groupings; confirm Phase 1 density (boxes/chips read `text-xs`, match the parked card).
2. Collapse the palette; confirm the rail (`Boxes` + count) and the board reflow.
3. Reload; confirm it stays collapsed with **no flash**. Expand, reload; confirm it stays expanded.
4. With a leading/companion filter applied, collapse then expand; confirm the filter selection is preserved.
5. Drag a grouping onto a cell while the palette is expanded; confirm the drop is unaffected.
6. Force the stale state (or inspect the stale panel) and confirm it renders at `w-64`.

## Performance Considerations

Collapse is pure CSS width animation + a single grid reflow on an explicit click — it never enters the placement/constraint validation path, so the <200ms drag-drop budget is untouched. The body stays mounted (no remount cost). The cookie read is a trivial server-side string parse already adjacent to the existing `Astro.cookies` usage.

## Migration Notes

No data migration. The cookie defaults to absent → `false` → palette starts expanded for every existing user (current behavior). No schema, Action, or Supabase change.

## References

- Research: `context/changes/planner-palette-ui-improvments/research.md`
- Template to mirror: `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx:24-35,55-60,84-102`
- Disclosure pattern: `src/_pages/plan-detail/ui/PlannerBoard.tsx:359-381`
- Per-device pref shape: `src/_pages/plan-detail/lib/shelf-pinned.ts`
- Canonical board-chip metric: `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx:125`
- "Mirror, don't share" rationale: `context/archive/2026-06-26-bundle-holding-container/reviews/impl-review.md:67-75`
- The deferral this picks up: `context/archive/2026-06-26-bundle-holding-container/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Grouping↔Bundle Density Parity

#### Automated

- [x] 1.1 Type check passes: `pnpm check` — 48b7e9a
- [x] 1.2 Linting passes: `pnpm lint` — 48b7e9a
- [x] 1.3 FSD structure check passes: `pnpm steiger` — 48b7e9a
- [x] 1.4 Unit tests pass: `pnpm test` — 48b7e9a
- [x] 1.5 Production build is clean: `pnpm build` — 48b7e9a

#### Manual

- [x] 1.6 Multi-member `GroupingBox` density matches `ParkedBundleCard`; grip + counter intact — 48b7e9a
- [x] 1.7 1-member grouping and promoted single chip render compact and identical — 48b7e9a
- [x] 1.8 No palette overflow/truncation regression; badge + hours counters align — 48b7e9a

### Phase 2: Collapsible PlannerPalette

#### Automated

- [x] 2.1 Type check passes: `pnpm check` — d48ae75
- [x] 2.2 Linting passes: `pnpm lint` — d48ae75
- [x] 2.3 FSD structure check passes: `pnpm steiger` — d48ae75
- [x] 2.4 Unit tests pass (palette collapse + cookie-parse): `pnpm test` — d48ae75
- [x] 2.5 Production build is clean: `pnpm build` — d48ae75

#### Manual

- [x] 2.6 Collapse to `w-9` rail (`Boxes` + count); board reflows; animation respects reduced-motion — d48ae75
- [x] 2.7 Rail click re-expands to `w-64`; filter + list intact, selection preserved — d48ae75
- [x] 2.8 Reload persists collapsed/expanded state with no hydration flash — d48ae75
- [x] 2.9 Dragging a grouping/chip still works; collapse not triggerable mid-drag — d48ae75
- [x] 2.10 Stale-suggestions state renders at stable `w-64` — d48ae75
- [x] 2.11 Dev (`http://localhost`) cookie is set and persists across reload — d48ae75
