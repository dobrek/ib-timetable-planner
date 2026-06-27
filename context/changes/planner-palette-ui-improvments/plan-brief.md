# Planner Palette UI Improvements — Plan Brief

> Full plan: `context/changes/planner-palette-ui-improvments/plan.md`
> Research: `context/changes/planner-palette-ui-improvments/research.md`

## What & Why

Two independent polish improvements to the left-edge planner palette: (1) shrink the grouping suggestion boxes to the same compact density as the bundle/chip they become, and (2) make the palette collapsible to a thin rail — like the right-edge shelf already is — so authors can reclaim horizontal space for the timetable. The density work is the planned continuation of `bundle-holding-container`, which densified the shelf/ghost/board chips and explicitly deferred the palette `GroupingBox` as out-of-scope.

## Starting Point

The palette is an always-open `<aside>` pinned to a fixed `18rem` grid track, with no collapse affordance; its `GroupingBox` is the last renderer still at the chunky `text-sm` density. The right-edge `ShelfDrawer` already implements the exact collapse/animate pattern to mirror, and `PlannerBoard` already owns the disclosure-state idiom (`useShelfDisclosure`).

## Desired End State

The grouping boxes and single-course chips read at the compact `text-xs` board-chip density. The palette collapses to a `w-9` rail (a `Boxes` icon over the grouping count) and expands back to `w-64`, animating smoothly with the board reflowing in step — and the collapsed/expanded choice survives a reload per-device, with no hydration flash.

## Key Decisions Made

| Decision                       | Choice                                            | Why (1 sentence)                                                              | Source   |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| Persistence mechanism          | Cookie read server-side, seeded into island state | Per-device persistence that is flash-free (the island can't run a pre-hydration script) | Research |
| Densify shared `PaletteCourseChip` | Yes                                            | Keep the palette uniform; the filter-promoted chip is a palette element       | Research |
| Code sharing                   | Class edits only, keep components separate         | Honor the prior "mirror, don't share" decision (content legitimately diverges) | Research |
| Reopen affordance              | Left-edge rail click only (no pin, no bar opener)  | The palette never auto-collapses, so an always-visible rail is sufficient      | Research |
| Expanded palette width         | `w-64` (16rem)                                     | A clean Tailwind step between the shelf's 15rem and the palette's current 18rem | Plan     |
| Collapsed rail content         | `Boxes` icon + total grouping count                | Symmetric with the shelf tab; signals how many suggestions are tucked away     | Plan     |
| Phase order                    | Density first, collapse second                      | Smallest/lowest-risk change ships as a clean first commit                      | Plan     |

## Scope

**In scope:**
- Densify `GroupingBox` (header + rows) and `PaletteCourseChip` to the board-chip metric.
- Collapsible palette: cookie helper + SSR threading + `usePaletteDisclosure` + collapsible aside mirroring `ShelfDrawer`.
- Grid track 1 `18rem` → `auto`; pin `GroupingStalePanel` to `w-64`.

**Out of scope:**
- Shared card-shell extraction; a pin concept; a `PlanSummaryBar` opener; cross-tab cookie sync.
- Any change to the shelf, overlay, placed chip, or palette content (counts/hours stay).

## Architecture / Approach

Phase 1 is three Tailwind class edits. Phase 2 clones the established disclosure pattern: a new `lib/palette-collapsed.ts` (cookie name + server-safe parse + client write) → `index.astro` reads the cookie → `paletteCollapsed` prop threads through `PlanDetailPage.astro` → `PlannerBoard` seeds `usePaletteDisclosure(initialCollapsed)` (writes the cookie on toggle) → `PlannerPalette` becomes a presentational collapsible aside (`w-9 ↔ w-64`, rail + body both mounted, toggled by display class). The board's first grid track moves to `auto` so the palette owns its animated width.

## Phases at a Glance

| Phase                          | What it delivers                                  | Key risk                                                        |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| 1. Density parity              | Compact grouping boxes + chips                    | Truncation/alignment regression in the palette list (low)      |
| 2. Collapsible palette         | Collapse/expand rail + flash-free persistence     | Hydration flash if the cookie isn't server-seeded correctly    |

**Prerequisites:** None — all precedents (shelf drawer, disclosure hook, cookie read) exist in-repo.
**Estimated effort:** ~1–2 sessions across 2 phases; each is independently shippable.

## Open Risks & Assumptions

- The flash-free guarantee depends entirely on the SSR cookie read seeding the island's initial state — reading the cookie inside the island would flash. (Mitigated by the threading design; verify by reloading while collapsed.)
- `Secure` must be conditional on HTTPS or the cookie silently fails to set in local dev. (Called out in the plan.)
- No cross-tab sync of the collapse state — accepted for a cosmetic per-tab toggle.

## Success Criteria (Summary)

- A palette grouping box reads at the same compact density as the parked bundle card it becomes.
- The palette collapses to a rail and expands back smoothly, with the board reflowing in step.
- The collapsed/expanded choice persists across a reload (per device) with no visible flash, and dragging from the palette is unaffected.
