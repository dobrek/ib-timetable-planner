# Sticky Day Names + Period Names on the Planner Board — Plan Brief

> Full plan: `context/changes/sticky-days-periods-names/plan.md`
> Research: `context/changes/sticky-days-periods-names/research.md`

## What & Why

The whole planner board scrolls today, so when an author scrolls a large preset (5×10) the day labels and period labels disappear and they lose track of which day/period a cell belongs to. We freeze the day-header row (top), the period-header column (left), and the top-left corner — a classic frozen-header spreadsheet — so context is never lost on either scroll axis.

## Starting Point

A single `PlannerGrid.tsx` renders both focus (1 cohort column) and combined (DP1│DP2) modes inside one `overflow-auto` scroll-port (`PlannerBoard.tsx:218`). The header cells already use the opaque `bg-background` token, the scroll chain is clean (no `transform`/`filter`/`contain` to break sticky), and dnd-kit is orthogonal to finite z-indexes. There is no existing `position: sticky` anywhere in the codebase — this is the first use.

## Desired End State

Scrolling vertically keeps day labels pinned at the top; scrolling horizontally keeps period labels pinned at the left; the corner stays pinned in both directions. In combined mode the DP1│DP2 cohort sub-label row stays pinned directly beneath the day row. Drag-and-drop, the period-break bands, and the <200 ms drag budget are all unaffected.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Technique | Pure CSS `position: sticky` on header cells | No scroll JS, zero cost to the <200 ms budget, no dnd-kit change | Research |
| Axes to freeze | Both + corner | Combined mode scrolls horizontally too, so the left column is genuinely needed | Plan |
| Two-row offset (combined) | `--day-header-h` CSS var | Single source of truth so day-cell height and sub-label `top` can never drift | Plan |
| Frozen-edge look | Flush (existing grid line) | Keeps the board's flat gridded look; avoids dark-mode shadow/seam tuning | Plan |
| Sticky granularity | Per header cell, not row | Rows are `display: contents` and have no box to stick | Research |
| z-scale | `z-10` bands, `z-20` corner | Fits the empty z gap, stays well under the `z-50` modal tier | Research |

## Scope

**In scope:** Sticky day-header row, period-header column, top-left corner (Phase 1); combined-mode cohort sub-label row pinned beneath the day row via `--day-header-h` (Phase 2). All in `PlannerGrid.tsx`.

**Out of scope:** Any shadow/border edge treatment; JS scroll-sync; markup/structural refactor; dnd-kit/collision/autoscroll changes; sub-`lg` responsive redesign (verify only); the catalog tables.

## Architecture / Approach

Add Tailwind sticky utilities to the existing header `<div>`s in `PlannerGrid.tsx`. Always-present headers (day row `top-0`, period column `left-0`, corner `top-0 left-0`) come first and fully solve focus mode. Combined mode's second header row sticks at `top: var(--day-header-h)`, where the var — set once on the grid root — is the single source for both the day-cell height and the sub-label offset. No new files, no new deps.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Always-present headers | Day row, period column, corner freeze (focus mode fully solved) | `gap-px` seam reading as content bleed in dark mode (`--border` is 10% alpha) |
| 2. Combined sub-label row | DP1│DP2 row pins under the day row; 2-row corner stack | Day-row height var must match prior content height or focus mode shifts |

**Prerequisites:** None — research complete, scroll-port and tokens already in place.
**Estimated effort:** ~1 session, 2 small phases in one file.

## Open Risks & Assumptions

- **`gap-px` seam**: the 1 px `bg-border` gap at the header/content boundary should read as a normal grid line; needs an eyeball in dark mode (mitigation available — extend the opaque cell bg).
- **Sub-`lg` viewports**: below `lg` the board column sizes from `auto` rows, so internal scroll may not occur; sticky still pins relative to whatever scroll exists. Assumed acceptable (desktop-first) — verify, don't redesign.
- **Day-header height pin**: choosing `--day-header-h` to match the current content-driven `p-2 text-xs` height keeps focus mode visually unchanged; a mismatch would shift it.

## Success Criteria (Summary)

- On a large preset, day and period labels stay visible while scrolling the board in any direction, in both focus and combined modes.
- Dragging a chip while scrolled: feedback floats above the frozen headers and drops still register on cells beneath them.
- No regression to the period-break bands, dark-mode seams, or the <200 ms drag budget; `lint`/`steiger`/`test`/`build` stay green.
