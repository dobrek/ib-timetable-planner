---
date: 2026-06-27T08:01:59+0200
researcher: Dobromir Kropielnicki
git_commit: ae102d1937ea41fa1dc467fd74e3bb5c4d3a0f99
branch: main
repository: ib-timetable-planner
topic: "Compact PlannerPalette via collapse/expand (mirroring shell/container/sidebar) + grouping↔bundle design parity"
tags: [research, codebase, plan-detail, planner-palette, grouping-box, shelf-drawer, collapse-expand, bundle]
status: complete
last_updated: 2026-06-27
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Locked the 4 open decisions; verified the cookie+SSR persistence threading path."
---

# Research: Compact PlannerPalette via collapse/expand + grouping↔bundle design parity

**Date**: 2026-06-27T08:01:59+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: ae102d1937ea41fa1dc467fd74e3bb5c4d3a0f99
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Check the feasibility of improving the `PlannerPalette` UI. Goal: a more compact design by introducing a collapse/expand feature like the "shell container" already has, backed by the same animation pattern already used for the shell, the container (shelf), and the sidebar. Also make sure the grouping boxes (which later become a bundle) share a similar design to the bundle.

## Summary

**Verdict: highly feasible, low-risk, and partly pre-decided.** Every one of the three sub-goals maps onto an existing, working precedent in the same slice — there is essentially nothing novel to invent.

1. **Collapse/expand container** — the right-edge `ShelfDrawer` (`src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx`) is exactly the feature requested, sitting symmetrically opposite the palette in the same board grid. It is a single persistent `<aside>` whose width animates `w-9 ↔ w-60`. Mirroring it on the left edge for the palette is a direct copy.

2. **Animation pattern** — there is one shared recipe used verbatim in **both** the sidebar rail and the shelf: `overflow-hidden transition-[width] duration-200 motion-reduce:transition-none`, toggling a collapsed vs expanded width. The shelf's doc + the archive note both say it "mirrors `SidebarLayout`'s rail." Reuse it unchanged.

3. **Grouping↔bundle parity** — `ParkedBundleCard` already *deliberately* "mirrors `GroupingBox`'s layout/classes" as the **more compact** variant. The two skeletons already match; only the *density axis* differs (`GroupingBox` header `px-3 py-2 text-sm` / rows `px-2 py-1.5 text-sm gap-2` vs the bundle's `px-2 py-1.5 text-xs` / `px-1.5 py-1 text-xs gap-1`). Critically, the immediately-prior change (`bundle-holding-container`) densified the bundle + ghost to the board-chip metric and **explicitly recorded that leaving `GroupingBox` chunky was an out-of-scope deferral, not a design choice** (`context/archive/2026-06-26-bundle-holding-container/change.md`). This change is the planned continuation of that work.

The main *decisions* (not blockers) for the plan: (a) is the palette collapse session-only or per-device persisted (persistence introduces a one-frame hydration flash — see Open Questions); (b) whether to also densify the shared `PaletteCourseChip` (used by both 1-member groupings and the filter-promoted single chip); (c) whether to extract a shared card shell or keep the deliberate "mirror, don't share" stance.

## Decisions Locked (2026-06-27)

Resolved with the user before planning. These supersede the Open Questions below (kept for rationale).

1. **Persistence → Cookie + SSR.** The collapse state persists per-device AND is flash-free: read the cookie server-side in the Astro page and seed the island's initial state from a prop. Chosen over session-only and `localStorage` (which flashes). It is a *new* mechanism for this repo (existing cosmetic prefs use `localStorage`), but `src/pages/plans/[id]/index.astro` already reads `Astro.cookies` for the Supabase client, so the read side has a precedent.
   - **Threading (verified):** `src/pages/plans/[id]/index.astro` reads `Astro.cookies.get("planner-palette-collapsed")?.value === "true"` → passes a `paletteCollapsed` boolean prop → `src/_pages/plan-detail/ui/PlanDetailPage.astro` (add to its `Props`, currently `planName` + `boardProps`) → `<PlannerBoard … paletteCollapsed client:load />` (`PlanDetailPage.astro:14`). The island seeds `useState(paletteCollapsed)`; first SSR + first client paint match (prop is serialized identically), so **no hydration mismatch, no flash**.
   - **Write side:** the toggle handler updates React state AND writes the cookie **client-side** via `document.cookie` (non-HttpOnly cosmetic flag). A small `src/_pages/plan-detail/lib/palette-collapsed.ts` should hold the cookie name + a `writePaletteCollapsed(boolean)` client helper (and optionally a parse helper shared with the `.astro` read). Suggested attributes: `path=/plans` (don't ride along on every asset/API request), `SameSite=Lax`, `Secure` in prod, `max-age` ~1 year.
   - **Not an Astro Action.** Per lessons.md, Actions are the transport for *app-data* mutations. This is a per-device *cosmetic* pref — same category as `drag-hint-mode`/`shelf-pinned` — so the client-side cookie write is correct; do **not** route it through an Action.
   - **Known minor gap:** a cookie has no cross-tab sync event (unlike the `localStorage` `storage` event the shelf-pinned pref uses). Acceptable for a cosmetic per-tab toggle; note it, don't engineer around it.

2. **Densify `PaletteCourseChip` too → Yes.** Keep the palette uniform; the filter-promoted single chip densifies with it (accepted — it's a palette element).

3. **Code sharing → Class edits, keep separate.** No shared shell. Just edit `GroupingBox` (and `PaletteCourseChip`) density classes; respect the prior "mirror, don't share" decision and keep the shelf/overlay out of scope.

4. **Reopener → Rail tab only.** Left-edge collapsed rail tab (icon + optional visible-grouping count), click-to-expand; `ChevronLeft` collapse button in the expanded header. **No pin, no `PlanSummaryBar` opener** — the palette never auto-collapses, so the always-visible rail is sufficient.

**Scope:** both the collapse/expand container and the grouping↔bundle density parity are in scope; they're independent and may land as separate commits.

## Detailed Findings

### Area 1 — Current PlannerPalette (the thing to make compact)

`src/_pages/plan-detail/ui/PlannerPalette.tsx:39-60` — the palette is an always-open `<aside data-slot="planner-palette" className="flex min-h-0 flex-col gap-6">` containing:
- a `shrink-0` filter header (`GroupingFilter`), and
- a scrollable list `min-h-0 flex-1 space-y-2 overflow-y-auto pr-1` of `GroupingBox` items, optionally led by a `PromotedCourseChip`.

It has **no collapse affordance** today and is given a **fixed `18rem` grid track** (it does not own its width — see Area 3).

Its filter selection state (`leadingCourseId`, `companionCourseId`) is **purely local** — `usePaletteFilter` at `PlannerPalette.tsx:99-121`, and the doc comment at `PlannerPalette.tsx:22-27` states "nothing outside the palette reads it." **Consequence: hiding/collapsing the palette body has zero cross-component data effect** — safe to collapse.

### Area 2 — The collapse/expand + animation pattern to reuse

There is **one** width-animation recipe, used in two places:

**Sidebar rail** — `src/app/layouts/SidebarLayout.astro:56`:
`transition-[width] duration-200 motion-reduce:transition-none overflow-hidden`, width `w-60` (expanded) ↔ `collapsed:w-16`. Collapsed content hidden via the `collapsed:hidden` utility, which is powered by a custom Tailwind variant `@custom-variant collapsed (&:is(.sidebar-collapsed *))` at `src/app/styles/global.css:5`. Persisted under localStorage key `"sidebar-collapsed"` via an inline pre-hydration `<script>` that pre-sets a `.sidebar-collapsed` class on `<html>` to avoid a flash (`SidebarLayout.astro:35-52, 160-173`). **This is the MPA/Astro mechanism — not directly reusable inside the React island.**

**Shelf drawer** — `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx:55-60`:
```
"bg-background flex max-h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border",
"transition-[width] duration-200 motion-reduce:transition-none",
expanded ? "w-60" : "w-9",
isDropTarget && "ring-ring ring-2",
```
Both the collapsed tab (`CollapsedTab`, `ShelfDrawer.tsx:84-102`) and the expanded body (`ExpandedShelf`, `:104-179`) **stay mounted** and are toggled by a display class (`hidden`/`flex`), not the HTML `hidden` attribute — `ShelfDrawer.tsx:91-96`. The doc comment (`:24-35`) spells out the contract: one persistent `<aside>`, never remounts, reflows "only ever … on a click (expand) or after a drop … never mid-drag." Icon-button recipe: `SHELF_ICON_BUTTON` at `ShelfDrawer.tsx:22` (`text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded`), which the comment notes "mirrors `SidebarLayout`'s rail."

The archive confirms the lineage and intent in plain language (`context/archive/2026-06-26-bundle-holding-container/change.md`): *"a single aside with the **same width-transition recipe as `SidebarLayout`'s rail** … animates `w-9 ↔ w-60` … Why: the user asked for collapse/expand animation; reusing the sidebar pattern keeps it consistent."*

**→ For the palette, copy the ShelfDrawer recipe (it's the React-island form), mirrored to the left edge** (collapse chevron points left; collapsed rail on the left). Keep rail + body both mounted, toggle by display class.

### Area 3 — Board layout + state wiring to mirror

**The board is a 3-column grid** — `PlannerBoard.tsx:217-219`:
`className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[18rem_minmax(0,1fr)_auto]"`
- Track 1 = palette, fixed **`18rem`** (palette does *not* own its width).
- Track 2 = board, **`minmax(0,1fr)`** — the `min:0` is load-bearing: it lets the timetable shrink+scroll instead of forcing the grid past the viewport (comment `PlannerBoard.tsx:214-216`). It absorbs reflow when either edge column resizes.
- Track 3 = shelf, **`auto`** — tracks the shelf aside's own animated width (`w-9 ↔ w-60`).

So the shelf collapses by **owning its width** in an `auto` track; the palette currently can't animate because its track is a hard `18rem`. **To mirror the shelf, change track 1 from `18rem` to `auto` and let `PlannerPalette` own its width** via the same `transition-[width]` recipe (`w-72/​w-64 ↔ w-9`). The board column stays `minmax(0,1fr)` and reflows in step. (Alternative: animate the grid-template track itself — simpler but doesn't clip/animate as cleanly; the own-width approach matches the shelf exactly.)

**Shelf disclosure state (the template)** — `useShelfDisclosure()` at `PlannerBoard.tsx:369-381`:
```ts
const pinned = useSyncExternalStore(subscribeShelfPinned, readShelfPinned, () => DEFAULT_SHELF_PINNED);
const [expanded, setExpanded] = useState(false);
return { shelfExpanded: expanded || pinned, pinned, setExpanded, setPinned: writeShelfPinned,
         collapseUnlessPinned: () => { if (!pinned) setExpanded(false); } };
```
- `pinned` = per-device persisted pref; `expanded` = in-memory `useState` (resets on reload). Wired into `<ShelfDrawer>` at `PlannerBoard.tsx:255-263`. A "badge" opener lives on `PlanSummaryBar` via `onExpandShelf` → `setExpanded(true)` (`PlannerBoard.tsx:207-209`). Auto-collapse-after-drop is `collapseUnlessPinned()` called post-drop only (`PlannerBoard.tsx:141,151,166`).

**The palette is simpler than the shelf**: it has **no auto-collapse trigger** and **no pin concept** (pin exists only because drops auto-collapse the shelf). So a single boolean suffices — no `expanded || pinned` derivation.

**Per-device pref shape to clone** — `src/_pages/plan-detail/lib/shelf-pinned.ts` (full file read): `DEFAULT_SHELF_PINNED=false`, `STORAGE_KEY="planner-shelf-pinned"`, `read*/write*/subscribe*` with try/catch (per lessons.md "Guard localStorage with try/catch"), consumed via `useSyncExternalStore` with the default as the **server snapshot**. `drag-hint-mode.ts` is the same shape. If persisting, clone to `palette-collapsed.ts` (`"planner-palette-collapsed"`).

**Drag/drop safety** — the palette is **not a droppable** (only the shelf at `ShelfDrawer.tsx:46` and slot cells at `SlotCell.tsx:157` are); it is only a *source* of draggables (`GroupingBox.tsx:31`, `PlannerPalette.tsx:77`). Collapse is a user click only and can't fire mid-drag of a palette item, so the mid-drag reflow hazard the shelf guards doesn't even arise. Keep the body mounted (display-class toggle) so an in-flight draggable never loses its source element. **The <200ms placement-validation budget is untouched** — collapse is pure CSS reflow and never enters the validation path.

### Area 4 — Grouping box vs bundle: what "share the design" means

**Every bundle/grouping renderer and its metrics:**
| Aspect | `GroupingBox` (palette) | `ParkedBundleCard` (shelf) | On-board `PlacedChip`/`SlotCell` | `OverlayCard` ghost |
|---|---|---|---|---|
| Skeleton | `bg-background rounded-lg border` | `bg-background rounded-lg border` | `SlotCell` `flex flex-col gap-1 p-1` | `bg-background w-56 rounded-lg border shadow-lg` |
| Header padding | **`px-3 py-2`** | `px-2 py-1.5` | n/a (control strip) | `px-2 py-1.5` |
| Header text | **`text-sm`** | `text-xs` | n/a | `text-xs` |
| Header gap | `gap-2` | `gap-2` | n/a | `gap-2` |
| Grip | `size-4` ✅ | `size-4` ✅ | none | `size-4` ✅ |
| Count/badge | "N courses" + "N students" | count dropped; A/B badge + week tags | none (per-chip controls) | "N courses" kept |
| Row padding | **`px-2 py-1.5`** | `px-1.5 py-1` | `px-1.5 py-1` | `px-1.5 py-1` |
| Row text | **`text-sm`** | `text-xs` | `text-xs` | `text-xs` |
| Row gap | **`gap-2`** | `gap-1` | `gap-1` | n/a |
| Row border | `rounded-md border` ✅ | `rounded-md border` ✅ | `rounded-md border` ✅ | `rounded-md border` ✅ |

`px-1.5 py-1 text-xs gap-1 rounded-md border` is the **canonical board-chip metric** (`PlacedChip.tsx:125`); the shelf card and the drag ghost were already aligned to it in commit `4e1bc79`. `GroupingBox` is the only renderer still at the chunky `text-sm` density.

**What already matches:** the box skeleton (`bg-background rounded-lg border` → header strip with `size-4` grip → `<ul space-y-1 px-2 pb-2>` → `rounded-md border` rows), the header gap, and the `<ul>` padding. **What differs is purely density** (plus legitimate content: the palette's student-coverage count + per-member hours, which the neutral bundle card omits).

**Minimal change to "share the bundle design"** (density only, no structural change):
1. `GroupingBox.tsx:58` header: `px-3 py-2 text-sm` → `px-2 py-1.5 text-xs` (keep `gap-2`, `font-medium`, `rounded-t-lg`).
2. `GroupingBox.tsx:81` member row: `gap-2 … px-2 py-1.5 text-sm` → `gap-1 … px-1.5 py-1 text-xs`.
3. **Decision:** 1-member groupings render via `PaletteCourseChip` (`GroupingBox.tsx:36-46`), which is **shared** with the filter-promoted single chip (`PlannerPalette.tsx:81`). It is `text-sm px-2 py-1.5 gap-2`. Densifying it for board-consistency also shifts the promoted single chip — intended or not?

### Area 5 — Grouping→bundle lineage (terminology the request leans on)

From `context/archive/2026-06-23-first-class-bundle-operations/research.md`:
- A **grouping** = a precomputed *palette suggestion* (`course_groupings`/`course_grouping_members`, keyed by `catalog_hash`) of which courses *could* run together — "**not** the placed/bundled-on-the-board entity" (`research.md:48`). `GroupingBox`'s docstring: "A palette hint box of co-runnable member courses."
- A **bundle** = the first-class placed/parked unit (`bundles` row, `placements.bundle_id`), under the model "**everything is a bundle; ungroup is presentation**" (`research.md:100,115`).
- **Lifecycle:** `course_grouping` (palette hint box) → **drag-drop** fans one placement per member into a cell, acquiring a `bundle_id` → on-board bundle (`SlotCell` of `PlacedChip`s) → **park** → `shelf_bundle` (`ParkedBundleCard`). One conceptual "set of courses," three tables, three renderers. So "grouping boxes that later become a bundle" = the same set, first as a suggestion box, then as a placed/parked card.

## Code References

- `src/_pages/plan-detail/ui/PlannerPalette.tsx:39-60` — palette aside (target of compaction); `:99-121` local filter state.
- `src/_pages/plan-detail/ui/GroupingBox.tsx:48-77` — grouping box container/header/rows (chunky `text-sm`); `:36-46` 1-member → `PaletteCourseChip`.
- `src/_pages/plan-detail/ui/shelf/ShelfDrawer.tsx:24-35,55-60,84-102` — the collapse/animate template to mirror.
- `src/_pages/plan-detail/ui/shelf/ParkedBundleCard.tsx:15-23,38-73` — the "mirrors GroupingBox" compact bundle variant.
- `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx:125` — canonical board-chip metric (`px-1.5 py-1 text-xs`).
- `src/_pages/plan-detail/ui/GroupDragOverlay.tsx:49-60` — drag ghost, already at compact density.
- `src/_pages/plan-detail/ui/PaletteCourseChip.tsx:30` — shared single chip (1-member groupings + promoted filter chip).
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:217-219` — 3-column board grid; `:255-263` shelf wiring; `:369-381` `useShelfDisclosure`; `:207-209` summary-bar opener.
- `src/_pages/plan-detail/lib/shelf-pinned.ts` — per-device boolean pref shape to clone.
- `src/app/layouts/SidebarLayout.astro:56,35-52,160-173` — sidebar rail recipe + Astro persistence (reference).
- `src/app/styles/global.css:5` — `@custom-variant collapsed`.

## Architecture Insights

- **One animation primitive, used three ways.** `transition-[width] duration-200 motion-reduce:transition-none overflow-hidden` is the house collapse animation (sidebar + shelf). Adding it to the palette makes the third instance — converging, not diverging. Honor `motion-reduce:` (lessons / a11y) verbatim.
- **Width-ownership is the layout lever.** Collapsible edge columns sit in an `auto` grid track and own their own `w-*` width; the center column is `minmax(0,1fr)` to absorb reflow. The palette must move from the fixed `18rem` track to `auto` to participate.
- **Never remount on collapse.** Both the rail and body stay mounted, toggled by a display class — this preserves dnd-kit draggable source elements and is the documented shelf contract.
- **Persistence vs flash tradeoff.** The shelf persists only `pinned` (an always-open intent) and keeps `expanded` in-memory precisely because the React island can't run a pre-hydration script; a persisted *collapsed* default would render expanded for one frame post-hydration then animate shut. Session-only collapse (`useState`) is flash-free and matches the shelf's `expanded`.
- **"Mirror, don't share" was a content decision, not a layout one.** The impl-review of `bundle-holding-container` (F5) explicitly reworded the comment away from "reuses the GroupingBox shell" to "standalone component that mirrors" — to stop a future editor from deduping two renderers whose *content* legitimately diverges (validated vs neutral; hours vs week tag; count vs no-count). Visual-density parity does **not** require sharing a component; the lowest-risk path is the 2–3 class edits.
- **Semantic tokens only** (lessons.md): every class added must be token-based (`bg-background`, `text-muted-foreground`, `hover:bg-accent`, …) — the existing recipes already are.

## Historical Context (from prior changes)

- `context/archive/2026-06-26-bundle-holding-container/change.md` — **the decisive precedent.** Built the `ShelfDrawer` collapse/animate (mirroring `SidebarLayout`'s rail), switched the board grid to `minmax(0,1fr)`, and densified `ParkedBundleCard` + `GroupDragOverlay` to board-chip metrics — then states verbatim: *"The palette `GroupingBox` was intentionally left at `text-sm` (out of scope — palette, not board/shelf)."* This change picks up exactly that deferral.
- `context/archive/2026-06-26-bundle-holding-container/reviews/impl-review.md:67-75` — F5: the "mirror, not share" wording fix for `ParkedBundleCard`.
- `context/archive/2026-06-23-first-class-bundle-operations/research.md:34,48,100,115` — grouping (suggestion) vs bundle (placed unit) terminology and the "everything is a bundle" model.
- Commit `4e1bc79` "feat(bundle-holding-container): size parked card + drag ghost to board chips" — the density alignment that left `GroupingBox` untouched.

## Related Research

- `context/archive/2026-06-26-bundle-holding-container/research.md` — shelf drawer design (the sibling pattern).
- `context/archive/2026-06-25-bundle-duplication/` and `context/archive/2026-06-23-first-class-bundle-operations/` — bundle model evolution.

## Open Questions

1. **Session-only or persisted palette collapse?** Session-only (`useState`, like the shelf's `expanded`) is flash-free and simplest. Per-device persisted (clone `shelf-pinned.ts`) survives reloads but a persisted-collapsed state flashes expanded-then-animates-shut for one frame after hydration (the island can't run a pre-hydration script like the sidebar). Recommendation: start session-only; treat persistence as an optional enhancement with a flash-mitigation note.
2. **Densify the shared `PaletteCourseChip`?** Aligning it makes 1-member groupings match the bundle, but also restyles the filter-promoted single chip (`PromotedCourseChip`). Decide whether that's in scope or whether the chip stays at palette density.
3. **Extract a shared card shell, or keep "mirror, don't share"?** A presentational `BundleCardShell` (header slot + row renderer + density prop) would unify `GroupingBox`/`ParkedBundleCard`/`OverlayCard`. The archive deliberately kept them separate on content-divergence grounds; the parity goal weakens but doesn't void that. Recommendation: ship the class-edit version first; treat extraction as a separate, optional refactor.
4. **Collapsed-rail affordance.** What does the collapsed palette rail show (icon + visible-grouping count, mirroring the shelf tab's Inbox + parked count)? And is a `PlanSummaryBar` opener wanted (symmetric to `onExpandShelf`), or is the rail click the only reopen control?
5. **Does "compact" mean only collapse, or also the density edit, or both?** The request reads as both (collapse/expand *and* grouping↔bundle parity). Confirm scope so the plan can sequence them (they're independent and can ship separately).
