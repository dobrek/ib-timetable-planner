---
change_id: bundle-holding-container
title: Bundle holding container
status: archived
created: 2026-06-26
updated: 2026-06-26
archived_at: 2026-06-26T20:21:36Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Post-implementation review refinements (PR #62)

Author review of the shipped feature surfaced six follow-ups, all addressed on the PR branch:

1. Shelf drawer now scrolls (bounded height) so parked cards past the fold stay reachable.
2. Parked card dropped the redundant "N courses" header; it is now **week-aware** (A/B summary badge + per-member week tag). Student-count was considered but skipped to keep the card decoupled from the validation catalog (author's call).
3. A palette grouping (or promoted single course) can be parked **directly** by dragging it onto the shelf — new `shelve_courses` RPC + `parkMembers` verb (no board round-trip).
4. The collapse button is disabled while the drawer is pinned (was a confusing silent no-op).
5. ~~Parking a course-set already on the shelf notifies instead of duplicating~~ — **reverted after user testing**: dropping an already-parked bundle intentionally parks a second copy (duplicates). The dedup guard + toast were removed.

### Drawer polish — collapse/expand animation + grid overflow fix

Follow-up UI pass on the shelf drawer:

- **`ShelfDrawer` refactored to one persistent `<aside>`.** Previously two separate `return` branches each hand-rolled the aside shell (ref, `data-slot`, `aria-label`, base styles, drop ring), which duplicated markup *and* meant the open/closed states mounted as different trees — nothing to animate. Now a single aside with the **same width-transition recipe as `SidebarLayout`'s rail** (`overflow-hidden transition-[width] duration-200 motion-reduce:transition-none`) animates `w-9 ↔ w-60`. The collapsed tab and expanded body both stay mounted and toggle via their display class (`hidden`/`flex`) rather than the HTML `hidden` attribute — a `.flex` utility would override `[hidden]` and leave the tab visible. Why: the user asked for collapse/expand animation; reusing the sidebar pattern keeps it consistent and drops the shell duplication at the same time.

- **Board grid `1fr` → `minmax(0,1fr)`** (`PlannerBoard.tsx`). With the left sidebar expanded *and* the shelf expanded, the shelf was cropped off the viewport. A bare `1fr` is `minmax(auto, 1fr)`, so the timetable column couldn't shrink below its min-content and forced the grid wider than `<main>` (`overflow-hidden`), clipping the rightmost (shelf) column. `minmax(0,1fr)` lets the timetable track shrink and scroll inside its own `overflow-auto` wrapper, so the fixed palette and `auto` shelf column always stay on-screen.

- **Bundle text sized to match the board** (`ParkedBundleCard.tsx`, `GroupDragOverlay.tsx`). The parked card and the drag ghost rendered course names at `text-sm` with looser padding, so they read as chunkier than the timetable. Both now use the placed-chip metrics (`px-1.5 py-1 text-xs`, board ref `PlacedChip.tsx`), and the drag ghost narrowed `w-64 → w-56` so it matches the parked card's footprint inside the `w-60` drawer. Why: the user wanted the bundle's text in line with the planner board for a denser, consistent look. The palette `GroupingBox` was intentionally left at `text-sm` (out of scope — palette, not board/shelf).

Verified: full local CI gate (`/verify`) green — `astro check` (0 errors), lint, steiger, audit, 618 unit tests, build. Shelf E2E DOM/a11y contract unchanged (`aria-label="Shelf"`, the `Open shelf (N parked)` tab label, pin/collapse buttons, `data-slot`/`data-expanded` hooks all preserved).
