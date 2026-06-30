---
date: 2026-06-30T23:14:12+0200
researcher: Dobromir Kropielnicki
git_commit: 4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of sticky day-header row and period-header column on the planner board"
tags: [research, codebase, plan-detail, planner-grid, sticky, css-grid, dnd-kit]
status: complete
last_updated: 2026-06-30
last_updated_by: Dobromir Kropielnicki
---

# Research: Sticky day names + period names on the planner board

**Date**: 2026-06-30T23:14:12+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of making the planner board's **day-header row** and **period-header column** sticky (frozen) so that when the user scrolls the board, the day labels and period labels stay visible — the user never loses track of which day/period a cell belongs to. Currently the whole board scrolls and context is easily lost.

## Summary

**Feasible — recommend GO, with a pure-CSS `position: sticky` approach.** Every load-bearing precondition holds:

- The scroll container already exists and is the *intended* sticky scroll-port: `PlannerBoard.tsx:218` `<div className="min-h-0 flex-1 overflow-auto">`.
- The full ancestor chain from `<body>` down to the grid cells is **clean** — no `transform`, `filter`, `perspective`, `contain`, `will-change`, or stray `overflow` that would break `position: sticky` or relocate its containing block.
- The drag-and-drop library (**@dnd-kit 0.5.0**) does **not** interfere: drag feedback is lifted to `position: fixed` + `z-index: calc(infinity)` + the browser top layer, so finite header z-indexes can never occlude it; collision detection is **geometric (bounding-rect)**, not pointer hit-testing, so a z-indexed sticky header can never block a droppable cell underneath it.
- It costs nothing against the **<200 ms per-drag budget**: `position: sticky` is pure CSS — no scroll listeners, no JS, no extra re-renders. Adding utility classes to the existing header `<div>`s does not touch the cell render path.

There are **two real implementation nuances** (neither a blocker):

1. **`display: contents` rows.** The grid's rows are `<div role="row" className="contents">` (`PlannerGrid.tsx:95,111,131`), which generate no box — so sticky must be applied to the **individual header cells**, never the row wrapper. You cannot make "a row" sticky; you make each header cell in that row sticky.
2. **Two stacked top header rows in combined mode.** The day-header row (always) plus the DP1│DP2 cohort sub-label row (combined only). The second row must stick at `top: <height-of-day-row>`, which needs a deterministic offset (a fixed header height or a CSS var), because the day-row height is currently content-driven (`p-2 text-xs`). Focus (single-cohort) mode has only one header row and is trivial.

There is **no prior art** in the repo: zero existing `position: sticky` usages anywhere in `src/**`, and no prior change ever discussed freezing day/period labels. This is genuinely new, but it lands cleanly on the existing structure.

---

## Orientation note (clarifying the request's terminology)

The request says "day column" and "period cohort rows," but in the actual grid the axes are the other way around — worth pinning down so the plan targets the right cells:

- **Days run horizontally** as a top **header row** (`role="columnheader"`, `PlannerGrid.tsx:98-106`). To freeze days during **vertical** scroll → `position: sticky; top: 0`.
- **Periods run vertically** as a left **header column** (`role="rowheader"`, `PlannerGrid.tsx:132-137`). To freeze periods during **horizontal** scroll → `position: sticky; left: 0`.
- The **cohort sub-labels** (DP1│DP2) are a second top header row under each day, combined mode only (`PlannerGrid.tsx:111-126`).

So "make days and periods sticky" = a classic 2-axis frozen-header spreadsheet: a sticky top band (1 row in focus, 2 rows in combined), a sticky left column, and a sticky top-left corner where they cross.

---

## Detailed Findings

### 1. The board structure and exactly which cells become sticky

`PlannerGrid.tsx` renders one CSS Grid for both focus (1 cohort column) and combined (2 cohort columns) modes (`PlannerGrid.tsx:75-180`):

- Grid root (`PlannerGrid.tsx:87-92`): `role="grid"`, `className="bg-border grid gap-px rounded-lg"`, inline `gridTemplateColumns: "auto repeat(days, minmax(7rem,1fr)[ minmax(7rem,1fr)])"`. The `bg-border` + `gap-px` is what paints the 1 px grid lines.
- Rows are `display: contents` (`PlannerGrid.tsx:95,111,131`) — they pass their children through as **direct grid items**.

The cells to make sticky (all already carry the opaque `bg-background` token — good):

| Cell | Location | Sticky to apply |
|------|----------|-----------------|
| Top-left corner (`role="presentation"`, `p-2`) | `PlannerGrid.tsx:96` | `sticky top-0 left-0` + highest header z |
| Day headers (`role="columnheader"`) | `PlannerGrid.tsx:98-106` | `sticky top-0` |
| Cohort sub-label leftmost (`role="presentation"`, `p-1`, **combined only**) | `PlannerGrid.tsx:112` | `sticky left-0` + `top: <day-row-h>` (sits in the corner stack) |
| Cohort sub-labels DP1│DP2 (`role="columnheader"`, **combined only**) | `PlannerGrid.tsx:116-122` | `sticky top: <day-row-h>` |
| Period headers (`role="rowheader"`) | `PlannerGrid.tsx:132-137` | `sticky left-0` |

Note the day header uses `gridColumn: span N` in combined mode (`PlannerGrid.tsx:101`) — sticky composes fine with a spanning grid item.

### 2. Scroll/overflow/height chain — clean, sticky will work

The sticky cells stick relative to `PlannerBoard.tsx:218` `<div className="min-h-0 flex-1 overflow-auto">`. The chain from the viewport down:

- `<html>`/`<body>` `height:100%` (`BaseLayout.astro:14,28,49-56`) → `SidebarLayout.astro:53` `flex h-screen` (the 100vh anchor) → `SidebarLayout.astro:127` `<main className="flex min-w-0 flex-1 flex-col overflow-hidden">` → `PlanDetailPage.astro:18` `flex h-full min-h-0 flex-1 flex-col` → `BoardShell.tsx:50` `flex min-h-0 flex-1 flex-col` → `BoardShell.tsx:56` `grid min-h-0 flex-1 … lg:grid-cols-[auto_minmax(0,1fr)_auto]` → `PlannerBoard.tsx:211` `flex min-h-0 flex-col gap-3` → `PlannerBoard.tsx:218` `min-h-0 flex-1 overflow-auto` → `PlannerGrid.tsx:86` `w-max min-w-full` → the grid.

Key points:
- **`min-h-0` is present at every flex level**, so the `overflow-auto` div scrolls **internally** rather than growing the page — exactly what sticky needs. This invariant is load-bearing and already documented historically (the `1fr` → `minmax(0,1fr)` change, see Historical Context).
- The only `overflow` on the chain is `<main overflow-hidden>` (`SidebarLayout.astro:127`), which sits **above** the scroll container, so it does **not** become the sticky scroll-port and does **not** break sticky — it only clips at the main box.
- **No `transform`/`filter`/`perspective`/`contain`/`will-change`** anywhere between `<body>` and the cells (repo-wide grep confirmed). These are the classic sticky-breakers; their absence is what makes this a low-risk change.
- The grid wrapper is `w-max min-w-full` (`PlannerGrid.tsx:86`): in combined mode the board is wider than the viewport (hard minimum ≈ 600 px, scaling with day/period presets), so **horizontal scroll is real** — the sticky **left** period column matters as much as the sticky **top** day row.

### 3. dnd-kit (@dnd-kit 0.5.0) does not interfere — verified against vendored source

Versions pinned exact in `package.json:29-30`: `@dnd-kit/react@0.5.0`, `@dnd-kit/dom@0.5.0`.

- **Drag feedback escapes the stacking contest entirely.** While dragging, the moving element (an overlay clone for grouping/bundle/parked drags, or the lifted original for placement/course drags) is promoted via injected CSS to `position: fixed !important; z-index: calc(infinity); pointer-events: none` and, where supported, into the **top layer** via the Popover API (`setAttribute("popover","manual")` + `showPopover()`). There is **no in-place transform left inside the grid flow.** ⇒ A sticky header with any finite z-index **cannot** occlude the drag feedback. (`BoardShell.tsx:72-74` only disables the *drop-return animation*; it doesn't change this.)
- **Collision detection is geometric, not hit-testing.** SlotCell registers droppables via `useDroppable` (`SlotCell.tsx:174`) with no custom detector, so dnd-kit falls back to `pointerIntersection ?? shapeIntersection` — both computed from the cell's measured `getBoundingClientRect`, **not** `document.elementFromPoint`. ⇒ A cell scrolled partly *under* a sticky header, or visually painted over by one, is **still fully detectable** as a drop target.
- **Autoscroll is active** (`AutoScroller` + `Scroller` from `defaultPreset`) and will scroll `PlannerBoard.tsx:218` when dragging near its edges — using the *container's* geometric edges, so it keeps working under a sticky header. UX nuance: the top-edge autoscroll band visually sits beneath the sticky day-header; functionally fine, worth an eyeball in verification.
- **Clean slate for z-index/position.** Grep across `src/_pages/plan-detail/ui/` found no `position`/`z-*`/`relative`/`absolute`/`sticky`/`isolate` anywhere in the grid/slot-cell tree (`SlotCell.tsx`, `PlacedChip.tsx` use only `flex`/tone/opacity classes). So a minimal scheme works: header bands `z-10`, the corner cell `z-20` (it must sit above both bands where they cross), normal cells stay auto. No `isolate`/stacking-context plumbing needed.
- **One constraint for the implementer:** do **not** introduce a `transform`/`filter` on any wrapper around the grid or the overlay. It would break both `position: sticky` *and* the top-layer popover's fixed-position fallback. (The existing `motion-safe:animate-pulse` on cells, `SlotCell.tsx:126`, is opacity-only — safe.)

### 4. Conventions, tokens, and z-index scale

- **No existing sticky anywhere** in `src/**` — this is the first use. The catalog tables (`CourseTable.tsx`, `TeacherTable.tsx`, `StudentTable.tsx`) and the shadcn `Table` primitive (`src/shared/ui/table.tsx`) are plain, non-frozen.
- **z-index scale is nearly empty:** the only value used anywhere is `z-50`, exclusively on Radix overlay/popover layers (`dialog.tsx`, `alert-dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`). ⇒ `z-10`/`z-20` for headers fit cleanly in the gap and stay well under the `z-50` modal tier.
- **Opaque background token:** `bg-background` is fully opaque in both themes (`global.css:10` light `oklch(1 0 0)`, `:68` dark `oklch(0.145 0 0)`, no alpha) — safe for sticky cells; scrolled content won't bleed through. **Caution:** `bg-border` is *semi-transparent in dark mode* (`global.css:88` `oklch(1 0 0 / 10%)`) — do **not** use it as a sticky background; keep it only for the hairline grid lines as today. Lesson alignment: use semantic tokens, never palette literals (`lessons.md` §"Use semantic theme tokens").
- **Existing "header stays, content scrolls" precedent uses flexbox, not sticky:** the palette and shelf panels use `shrink-0` header + `min-h-0 flex-1 overflow-y-auto` body inside a `flex flex-col` (`CollapsibleEdgePanel.tsx:91-119`, `PaletteBody.tsx:45-56`, `ShelfDrawer.tsx:88`). That flex idiom can't express a 2-axis frozen grid, so `position: sticky` is the correct new tool here — just be aware it's a new pattern in the codebase.
- **ui-conventions.md** reinforces a CSS-only approach: components are declarative JSX with no `useState/useEffect/useMemo` in the body (`ui-conventions.md:56-59`); memoization is manual (no React Compiler), and the grid deliberately avoids broad re-renders for the <200 ms budget (`ui-conventions.md:232-233`). A scroll-listener/JS sticky would fight all of this; pure CSS sidesteps it.

### 5. Performance / the <200 ms per-drag budget

`position: sticky` adds **zero** to the budget — it's pure layout CSS, no scroll handlers, no state, no re-render. The grid's whole architecture is built to avoid per-tick re-renders of all cells (the `CellWiring` "spread, not a Context" decision, `PlannerGrid.tsx:17-25`); a CSS-only sticky stays entirely clear of that hot path. This is the decisive reason to prefer CSS sticky over any JS scroll-sync alternative.

---

## Recommended approach (for the plan phase)

1. **Pure CSS / Tailwind utilities on the existing header cells in `PlannerGrid.tsx`.** No new deps, no structural change, no dnd-kit change.
2. **Sticky targets:**
   - Day headers (`:98-106`): `sticky top-0 z-10`.
   - Period headers (`:132-137`): `sticky left-0 z-10`.
   - Top-left corner (`:96`): `sticky top-0 left-0 z-20`.
   - Combined mode only: cohort sub-labels (`:116-122`) `sticky` at `top: <day-row-height>`; its leftmost presentation cell (`:112`) `sticky left-0` at the same top offset (it's part of the frozen corner stack).
3. **Solve the two-row offset deterministically.** Give the day-header row a known height (e.g. a fixed `h-*` on the day-header cells, or a `--day-header-h` CSS var on the grid) and set the cohort row's `top` to it. Don't rely on the content-driven height. Gate the second-row sticky behind `multi` (it doesn't exist in focus mode).
4. **Verify the `gap-px` seam.** The 1 px `bg-border` gap between a sticky header and the first scrolling row may show a hairline during scroll (it matches existing grid lines, so likely acceptable). Confirm visually; if distracting, the sticky cell's opaque `bg-background` can be extended to cover the seam.
5. **Visual checks during `/10x-e2e` or manual verify:** (a) drag a chip while scrolled — feedback must float above headers (expected, given the infinity-z lift); (b) drop onto a cell tucked under the sticky day-header — must still register (expected, geometric collision); (c) the period-break bands (`col-[1/-1]`, `:170-174`) must render correctly beneath the sticky left column; (d) sub-`lg` responsive (see Open Questions).

---

## Code References

GitHub permalinks at commit `4bd9b38`:

- [`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:86-137`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L86-L137) — the grid; the header/row-header/corner cells to make sticky; `display:contents` rows.
- [`src/_pages/plan-detail/ui/PlannerBoard.tsx:218`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/_pages/plan-detail/ui/PlannerBoard.tsx#L218) — the `overflow-auto` scroll-port (sticky containing block).
- [`src/_pages/plan-detail/ui/chrome/BoardShell.tsx:50-64`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/_pages/plan-detail/ui/chrome/BoardShell.tsx#L50-L64) — flex column + 3-col shell; `DragDropProvider` renders no DOM box.
- [`src/app/layouts/SidebarLayout.astro:53`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/app/layouts/SidebarLayout.astro#L53) — `flex h-screen` height anchor; `:127` `<main … overflow-hidden>` (above the scroll-port, harmless).
- [`src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:168-189`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx#L168-L189) — droppable registration (geometric collision; no custom detector).
- [`src/app/styles/global.css:10,68,88,189-200`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/src/app/styles/global.css#L189-L200) — `--background` (opaque), `--border` (dark = 10% alpha), `bg-period-break` hatch ("pair with `bg-background`").
- [`package.json:29-30`](https://github.com/dobrek/ib-timetable-planner/blob/4bd9b380265d5d425b2e55ea0a0c53ab6d3c50fe/package.json#L29-L30) — `@dnd-kit/react@0.5.0`, `@dnd-kit/dom@0.5.0`.

## Architecture Insights

- **`display: contents` rows are the defining structural fact.** They make the grid resilient to row insertion (no `grid-row` math) and let header cells be direct grid items — which is exactly why per-cell sticky works, but also why you can't shortcut by making a row wrapper sticky.
- **dnd-kit's top-layer/`z-index: calc(infinity)` feedback model means drag-and-drop is orthogonal to any finite z-index UI.** Sticky headers, future sticky toolbars, etc., are all safe to layer below `z-50` without ever fighting the drag overlay — provided no ancestor introduces a `transform` (which would also re-break sticky).
- **The codebase's "frozen header" instinct so far is flex (`shrink-0` + scrolling body), not `position: sticky`.** This is the first 2-axis frozen-grid need, where flex can't help — a deliberate, well-scoped introduction of a new but standard CSS pattern.
- **CSS-only is the architecturally correct lever** given the explicit <200 ms re-render budget and the "no effects in component bodies" convention.

## Historical Context (from prior changes)

- `context/archive/2026-06-29-breaks-between-periods/research.md:51,167` — documents the `display:contents` rows decision and why it's load-bearing ("had the grid used explicit `grid-template-rows`/per-cell `grid-row`, every insertion would shift row math"). Direct relevance: sticky must target cells, not rows.
- `context/archive/2026-06-26-bundle-holding-container/change.md:30` & `context/archive/2026-06-27-planner-palette-ui-improvments/research.md:94` — the board track went `1fr` → `minmax(0,1fr)` specifically so the timetable "shrinks and scrolls inside its own `overflow-auto` wrapper." This scroll-port is the foundation sticky relies on; keep it intact.
- `context/archive/2026-06-12-unify-navigation/research.md:68` — `w-max min-w-full`, hard minimum ≈ 600 px, horizontal scroll via the `overflow-auto` container; presets 5×6 / 5×8 / 5×10. Confirms horizontal scroll (→ sticky-left column) is a real need, not just vertical.
- `context/archive/2026-06-27-combined-two-cohort-view/` and `context/archive/2026-06-28-plan-detail-unify-views/plan.md:255` — built and then merged the paired/single grids into today's one `PlannerGrid.tsx`; the spanning day header, the DP1│DP2 sub-label row, and the sibling-dim are all gated on `columns.length > 1`. Direct relevance: sticky must handle 1 *or* 2 top header rows by mode.
- `context/archive/2026-06-22-slot-cell-refactor/research.md:83` — flags a "dense-cell overflow risk" (cells `min-h-16`, no max, only the outer container scrolls). Sticky doesn't worsen this, but it's adjacent context for cell sizing.
- `context/archive/2026-06-29-breaks-between-periods/` — added the full-width `col-[1/-1]` break bands (`PlannerGrid.tsx:170-174`); a sticky left column must coexist with these auto-flowed full-row spacers (it will, via z-order).
- **No prior change discusses sticky/frozen headers or "losing context while scrolling"** — grep across `context/changes` + `context/archive` returned only unrelated hits (sidebar "sticky preference", grouping "sticky" overrides, `--frozen-lockfile`). This concern is new.

## Related Research

- None directly on this topic. Nearest neighbors: `context/archive/2026-06-29-breaks-between-periods/research.md` (grid structure) and `context/archive/2026-06-28-plan-detail-unify-views/plan.md` (the unified grid contract).

## Open Questions

1. **Two-row top offset.** Pin the day-header row to a deterministic height so the cohort sub-label row can offset against it. Decide between a fixed `h-*` on header cells vs. a `--day-header-h` CSS variable. (Plan-phase decision.)
2. **Sub-`lg` responsive behavior.** Below the `lg` breakpoint the 3-column shell collapses to a vertical stack and the board column's height comes from `auto` rows, not the `minmax(0,1fr)` track — so the `overflow-auto` div may size to content (page/`main` clip) rather than producing an internal scroll. Sticky still pins relative to whatever scroll exists, but confirm in a narrow viewport whether the board actually scrolls internally there. Likely acceptable (desktop-first planner), but verify.
3. **`gap-px` seam during scroll.** Confirm the 1 px `bg-border` seam between a sticky header and the first scrolling row reads as a normal grid line and not as content bleed (especially dark mode, where `--border` is 10%-alpha). Mitigation available if needed (extend the opaque cell bg).
4. **Scope confirmation.** Freeze both axes (day row *and* period column) — the request implies both, and combined-mode horizontal scroll makes the left column genuinely necessary. Confirm before planning.
</content>
</invoke>
