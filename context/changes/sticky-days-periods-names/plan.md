# Sticky Day Names + Period Names on the Planner Board — Implementation Plan

## Overview

Freeze the planner board's **day-header row** (top), **period-header column** (left), and the **top-left corner** where they cross, so that scrolling the board never hides which day or period a cell belongs to. The change is pure CSS `position: sticky` applied to the existing header cells in `PlannerGrid.tsx` — no new dependencies, no structural change, no dnd-kit change, and zero cost against the <200 ms per-drag budget.

## Current State Analysis

The whole board scrolls inside `PlannerBoard.tsx:218` `<div className="min-h-0 flex-1 overflow-auto">` — including the day labels and period labels, so context is lost on scroll. Findings from research (`context/changes/sticky-days-periods-names/research.md`), verified against the source:

- **One grid, two modes** (`PlannerGrid.tsx:75-180`): focus mode renders one cohort column per day; combined mode renders two (DP1│DP2). The header cells to freeze already carry the opaque `bg-background` token — safe sticky backgrounds.
- **Rows are `display: contents`** (`PlannerGrid.tsx:95,111,131`) — they generate no box, so sticky must be applied to **individual header cells**, never the row wrapper.
- **Combined mode stacks two top header rows**: the day row (`:98-106`, each `gridColumn: span N`) and the DP1│DP2 cohort sub-label row (`:116-122`). The second row must stick *below* the day row, which needs a deterministic day-row height.
- **The scroll chain is clean**: `min-h-0` at every flex level keeps `overflow-auto` scrolling internally; no `transform`/`filter`/`perspective`/`contain`/`will-change` anywhere between `<body>` and the cells (the classic sticky-breakers are absent). The grid wrapper is `w-max min-w-full` (`PlannerGrid.tsx:86`), so combined mode is wider than the viewport — horizontal scroll is real, making the sticky **left** period column genuinely necessary.
- **dnd-kit (@dnd-kit 0.5.0) is orthogonal**: drag feedback lifts to `position: fixed; z-index: calc(infinity)` + the browser top layer, so finite header z-indexes can never occlude it; collision detection is geometric (`getBoundingClientRect`), not pointer hit-testing, so a cell tucked under a sticky header is still a valid drop target.
- **z-index scale is nearly empty**: the only value used anywhere is `z-50` (Radix overlays). So `z-10` bands / `z-20` corner fit cleanly in the gap and stay well under the modal tier. No `isolate`/stacking-context plumbing is needed.
- **No prior `position: sticky` anywhere in `src/**`** — this is the first use. The existing "frozen header" idiom in the codebase is flexbox (`shrink-0` header + scrolling body), which cannot express a 2-axis frozen grid; `position: sticky` is the correct new tool.

## Desired End State

Scrolling the board vertically keeps the day labels pinned at the top; scrolling horizontally keeps the period labels pinned at the left; the top-left corner stays pinned in both directions. In combined mode the DP1│DP2 cohort sub-label row stays pinned directly beneath the day row. The frozen edges read as the board's existing 1 px grid hairline (flush — no new shadow). Drag-and-drop, collision detection, the period-break bands, and the <200 ms budget are all unaffected.

Verify by: scrolling a large preset (5×10) in both focus and combined mode and confirming labels stay visible; dragging a chip while scrolled and confirming feedback floats above the headers and drops register on cells under the headers.

### Key Discoveries:

- Sticky must target **cells, not rows** — `display: contents` rows have no box (`PlannerGrid.tsx:95,111,131`).
- `bg-background` is fully opaque in both themes (`global.css:10` light, `:68` dark) — safe sticky bg. **`bg-border` is semi-transparent in dark mode** (`global.css:88`, 10% alpha) — never use it as a sticky background; it stays only as the hairline grid line.
- The cohort sub-label row offset is the only place a pinned height is required; focus mode has a single top header row and is trivial (`top-0`).
- The corner cell must sit above both bands where they cross → it needs the highest header z (`z-20`).

## What We're NOT Doing

- **No new visual treatment** — no separating shadow or accent border on the frozen edges (chosen: flush, rely on the existing grid line).
- **No JS scroll listeners / scroll-sync** — pure CSS only, to stay clear of the cell render hot path and the <200 ms budget.
- **No structural/markup refactor** — rows stay `display: contents`; no row-wrapper boxes are introduced.
- **No dnd-kit, collision, or autoscroll changes.**
- **No responsive redesign** for sub-`lg` viewports — desktop-first planner; sticky pins relative to whatever scroll exists. (Verified, not redesigned — see Phase 1 manual checks.)
- **No change to the catalog tables** (`CourseTable`, `TeacherTable`, `StudentTable`) — out of scope.

## Implementation Approach

Apply Tailwind sticky utilities directly to the existing header cells in `PlannerGrid.tsx`, in two phases. Phase 1 freezes the three always-present header regions (day row, period column, corner) — this fully solves focus mode and freezes everything in combined mode except the second header row. Phase 2 adds the combined-only cohort sub-label row, pinned beneath the day row via a single `--day-header-h` CSS variable that is the one source of truth for both the day-cell height and the sub-label `top` offset, so the two can never drift.

## Critical Implementation Details

- **Sticky targets individual cells, never the `role="row"` wrapper** — the wrappers are `display: contents` and have no box. Applying sticky to them is a silent no-op.
- **Single source of truth for the two-row offset**: define `--day-header-h` on the grid root (`PlannerGrid.tsx:87`), set the day-header cells' height from it, and set the cohort sub-label row's (and its leftmost corner cell's) `top` from the same var. Do not hand-duplicate the value.
- **z-order**: day band and period column at `z-10`; the corner stack (top-left presentation cell, and in combined mode the sub-label leftmost presentation cell) at `z-20` so it stays above both bands where they cross. Normal cells stay auto. Do not introduce any `transform`/`filter` on a wrapper around the grid — it would re-break both `position: sticky` and dnd-kit's top-layer fallback.

## Phase 1: Freeze the always-present headers

### Overview

Make the day-header row sticky to the top, the period-header column sticky to the left, and the top-left corner sticky to both — with a minimal `z-10`/`z-20` scale. This fully solves focus mode; in combined mode the day row, period column, and corner freeze (the cohort sub-label row is handled in Phase 2).

### Changes Required:

#### 1. Top-left corner cell

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Pin the empty corner cell to both edges so it stays in place under all scrolling and covers the spot where the day row and period column cross.

**Contract**: The `role="presentation"` cell at `:96` gains `sticky top-0 left-0 z-20`. It already has `bg-background` (opaque). No markup change beyond the className.

#### 2. Day-header row

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Freeze the day labels at the top during vertical scroll, in both modes.

**Contract**: Each `role="columnheader"` day cell at `:98-106` gains `sticky top-0 z-10`. The existing `gridColumn: span N` inline style (combined mode) composes fine with sticky. Background stays the opaque `bg-background` already present.

#### 3. Period-header column

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Freeze the period labels at the left during horizontal scroll (real in combined mode, where the board is wider than the viewport).

**Contract**: Each `role="rowheader"` period cell at `:132-137` gains `sticky left-0 z-10`. Background stays the opaque `bg-background` already present.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro sync && pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit suite passes: `pnpm test`
- Production build stays clean (Workers runtime): `pnpm build`

#### Manual Verification:

- Focus mode, large preset (5×10): scrolling vertically keeps day labels pinned; scrolling horizontally keeps period labels pinned; the corner stays put in both directions.
- Combined mode: day row, period column, and corner all freeze (cohort sub-label row not yet frozen — expected at this phase).
- Drag a chip while the board is scrolled: feedback floats **above** the sticky headers (not occluded).
- Drop onto a cell partly tucked under the sticky day-header or period-column: the drop still registers.
- Period-break bands (`col-[1/-1]`, `:170-174`) render correctly beneath the sticky left column (no overlap glitch).
- `gap-px` seam between a sticky header and the first scrolling row reads as a normal grid hairline (check **dark mode** especially, where `--border` is 10% alpha) — no content bleed-through.
- Narrow (sub-`lg`) viewport: confirm whether the board scrolls internally there and, if it does, that sticky behaves; if it does not scroll internally, confirm there is no visual regression. (Likely acceptable — desktop-first.)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Combined-mode cohort sub-label row

### Overview

In combined mode only, pin the DP1│DP2 cohort sub-label row directly beneath the frozen day row, and fold its leftmost cell into the frozen corner stack — using a single `--day-header-h` CSS variable as the source of truth for both the day-cell height and the sub-label `top` offset.

### Changes Required:

#### 1. Day-header height variable

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Establish one deterministic day-row height that both the day cells consume and the sub-label row offsets against, so the two never drift apart.

**Contract**: Define `--day-header-h` on the grid root (`:87-92`, alongside the existing inline `gridTemplateColumns`). The day-header cells (`:98-106`) consume it as their height (e.g. a height utility reading the var). Pick a value that matches the current content-driven `p-2 text-xs` day-row height so focus mode is visually unchanged. The var is set unconditionally (harmless in focus mode); only Phase 2's offset reads it.

#### 2. Cohort sub-label row — sticky offset

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Freeze the DP1│DP2 sub-labels directly under the day row so the cohort each sub-column belongs to stays visible on vertical scroll.

**Contract**: Each `role="columnheader"` sub-label cell at `:116-122` gains `sticky z-10` with `top: var(--day-header-h)`. This row exists only when `multi` (already gated at `:110`), so no focus-mode guard is needed beyond the existing conditional.

#### 3. Cohort sub-label leftmost presentation cell — corner stack

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx`

**Intent**: Keep the cell directly under the top-left corner pinned to the left edge at the same vertical offset, so the frozen corner reads as a solid 2-row block in combined mode.

**Contract**: The `role="presentation"` cell at `:112` gains `sticky left-0 z-20` with `top: var(--day-header-h)`. It already has `bg-background`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro sync && pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit suite passes: `pnpm test`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Combined mode, large preset: scrolling vertically keeps **both** the day row and the DP1│DP2 sub-label row pinned, stacked correctly with no overlap or gap between them.
- The two-row frozen corner (top-left + sub-label leftmost) stays solid and pinned during horizontal **and** vertical scroll; the sub-label leftmost cell does not detach from the period column.
- Focus mode is visually unchanged vs. before this change (the `--day-header-h` value matches the prior day-row height).
- Re-run the Phase 1 drag/drop and `gap-px` seam checks in combined mode — feedback floats above both header rows; drops register; no bleed at either seam.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- This is a presentational CSS-only change with no new domain logic, so no new unit tests are warranted. The existing `pnpm test` suite must stay green (no regression in `PlannerGrid` consumers).

### Integration Tests:

- None required — no data flow, API, or state change. The existing integration suite must stay green.

### Manual Testing Steps:

1. Open a plan in **focus** mode on a large preset (5×10). Scroll down → day labels pinned. Scroll right → period labels pinned. Scroll diagonally → corner pinned. (Phase 1)
2. Switch to **combined** mode. Repeat (1); additionally confirm the DP1│DP2 sub-label row pins under the day row and the 2-row corner stays solid. (Phase 2)
3. While scrolled, **drag a chip** — confirm the drag feedback floats above the frozen headers.
4. **Drop onto a cell** partly tucked under a frozen header — confirm the drop registers.
5. Inspect the **`gap-px` seam** in both light and dark mode at the header/content boundary — confirm it reads as a grid line, not content bleed.
6. Confirm the **period-break bands** render correctly beneath the frozen period column.
7. Narrow the window below `lg` — confirm no visual regression and that sticky behaves relative to whatever scroll exists.

## Performance Considerations

`position: sticky` is pure layout CSS — no scroll handlers, no state, no re-render. It stays entirely clear of the grid's `CellWiring` "spread, not Context" hot path (`PlannerGrid.tsx:17-25`) and adds **zero** to the <200 ms per-drag budget. This is the decisive reason CSS sticky is preferred over any JS scroll-sync alternative.

## Migration Notes

None. No schema, data, or API changes. Purely additive CSS classes / one CSS variable on an existing component; trivially reversible by removing the utilities.

## References

- Research: `context/changes/sticky-days-periods-names/research.md`
- The grid (cells to freeze, `display: contents` rows): `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:86-137`
- Scroll-port (sticky containing block): `src/_pages/plan-detail/ui/PlannerBoard.tsx:218`
- Opaque/transparent tokens: `src/app/styles/global.css:10,68,88`
- Droppable registration (geometric collision): `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:168-189`
- `display: contents` rows decision: `context/archive/2026-06-29-breaks-between-periods/research.md:51,167`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Freeze the always-present headers

#### Automated

- [ ] 1.1 Type checking passes (`pnpm exec astro sync && pnpm lint`)
- [ ] 1.2 FSD structure check passes (`pnpm steiger`)
- [ ] 1.3 Unit suite passes (`pnpm test`)
- [ ] 1.4 Production build stays clean (`pnpm build`)

#### Manual

- [ ] 1.5 Focus mode: day row, period column, corner all freeze on scroll
- [ ] 1.6 Combined mode: day row, period column, corner freeze (sub-label row not yet — expected)
- [ ] 1.7 Drag feedback floats above sticky headers while scrolled
- [ ] 1.8 Drop registers on a cell tucked under a sticky header
- [ ] 1.9 Period-break bands render correctly beneath the sticky left column
- [ ] 1.10 `gap-px` seam reads as a grid hairline (no bleed, incl. dark mode)
- [ ] 1.11 Sub-`lg` viewport behaves / no visual regression

### Phase 2: Combined-mode cohort sub-label row

#### Automated

- [ ] 2.1 Type checking passes (`pnpm exec astro sync && pnpm lint`)
- [ ] 2.2 FSD structure check passes (`pnpm steiger`)
- [ ] 2.3 Unit suite passes (`pnpm test`)
- [ ] 2.4 Production build stays clean (`pnpm build`)

#### Manual

- [ ] 2.5 Combined mode: day row + DP1│DP2 sub-label row both pin, stacked with no overlap/gap
- [ ] 2.6 Two-row frozen corner stays solid on horizontal and vertical scroll
- [ ] 2.7 Focus mode visually unchanged (`--day-header-h` matches prior day-row height)
- [ ] 2.8 Drag/drop + `gap-px` seam checks re-pass in combined mode
