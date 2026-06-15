# Disambiguate Palette Drag — Plan Brief

> Full plan: `context/changes/dnd-single-course-from-palette/plan.md`
> Research: `context/changes/dnd-single-course-from-palette/research.md`

## What & Why

The palette shows N+1 visually identical grab handles per group box — one grip on the header (drags
the whole group) and one on every member row (drags that single course) — with nothing signaling
scope. That stacked-identical-grips look is the entire source of the reported confusion. We fix it by
giving each group box exactly one gesture and surfacing an individual course as a single draggable
chip promoted from the leading-course filter. The change is **UI-only** — the placement model, write
paths, Actions, DB, and the <200 ms validation core are untouched.

## Starting Point

`GroupingBox` is a whole-group draggable with the header as its handle, and each member row is a
separate `useDraggable<CourseDrag>` — the only `CourseDrag` producer in the app. The leading-course
filter (shipped recently) already enumerates every individual course with name + count, and its
selection is purely palette-local. `addCourse` places any course independent of groupings.

## Desired End State

Each multi-member box has one gesture: grab anywhere on the box to drag the whole group; member rows
are display-only. Selecting a leading course pins that course as a draggable chip at the top of the
list; dragging it places just that course. A 1-member grouping renders as a chip too. The visual
language reads cleanly: **chip = a single placeable course, box = a multi-course group.**

## Key Decisions Made

| Decision                       | Choice                                              | Why (1 sentence)                                                              | Source   |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Singles surface                | Filter-promoted chip at top of list                 | Matches the "first element of the list" intent; reuses the filter + `addCourse`, zero model change. | Research |
| Singles universe               | Only the selected leading course (one chip)         | User wants exactly the leading course draggable; re-select to stage another — no `catalog` prop.     | Plan     |
| Group-box gesture              | Whole box draggable (drop the header handle)        | "The box is the group, grab it anywhere" — one unambiguous gesture once rows are gone.               | Plan     |
| Discoverability before select  | No explicit signal except the chip's grip icon      | The grip on the promoted chip is the affordance; no helper text / label change / placeholder.        | Plan     |
| Singleton (1-member) boxes      | Render as chips (visually distinguished)            | A 1-member group is effectively a single course; chip styling makes that legible and coherent.       | Plan     |
| Drag overlay for singles        | Keep existing behavior (no new overlay)             | Chip uses default source-element feedback; singleton keeps the `GroupDragOverlay` clone.             | Research |

## Scope

**In scope:**
- A promoted single-course chip (`CourseDrag`, id `single:${courseId}`) rendered first in the palette list when a course is selected.
- A shared presentational chip component reused by the promoted chip and singleton groupings.
- Whole-box-draggable group boxes; display-only member rows; chip-styled 1-member groupings.

**Out of scope:**
- Any model / write-path / Action / DB / schema change; the `DragData` union and constraint core.
- Passing `catalog` to the palette; an always-present singles section; in-box drag-out affordance.
- Helper text, filter label rename, empty-state placeholder; combobox / clear-button rework.
- A new chip-shaped drag overlay.

## Architecture / Approach

Two React components in one slice (`plan-detail/ui`). Phase 1 is additive: extract a shared
presentational chip and render the selected leading course as a draggable chip — group-box rows still
work, so single-course placement is never unavailable. Phase 2 is subtractive + restyle: remove the
row draggables (rows become display-only), make the whole box the drag activator (drop the header
handle, keep one grip as a hint), and render 1-member groupings as chips. The chip then becomes the
sole `CourseDrag` producer. All edits are downward-only imports (`model/*`, `@/shared/*`) — no steiger
risk; pure client-side rendering over already-loaded props.

## Phases at a Glance

| Phase                                                   | What it delivers                                                              | Key risk                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Promote leading course to a draggable single chip    | Shared chip presentation + promoted chip at top of list (additive)            | Chip drag feedback / hint parity with the existing row drag.             |
| 2. Whole-only boxes + whole-box drag + chip singletons  | One gesture per box; display-only rows; 1-member groupings as chips           | Whole-box activator vs. removed nested draggables; singleton overlay read.|

**Prerequisites:** A plan with computed groupings to test against (local Supabase seed).
**Estimated effort:** ~1 session across 2 phases (UI-only, ~2 files touched).

## Open Risks & Assumptions

- The promoted-chip path reuses `CourseDrag → addCourse` verbatim, so hint/overlay/feedback behavior
  should match today's row drag — to be confirmed manually.
- A leading course that also forms a 1-member grouping will appear twice (promoted chip + singleton
  chip); both place the same course — benign redundancy, accepted.
- The singleton drag overlay still shows the "N courses" `OverlayCard`; kept as-is and verified by eye
  rather than reshaped into a chip.

## Success Criteria (Summary)

- A user can place a single course only via the clearly-distinct promoted chip; each group box shows
  exactly one grip and one gesture.
- Dragging the chip and dragging a whole box produce the same placements as before the change.
- `pnpm build`, `pnpm lint`, `pnpm steiger`, and `pnpm test` stay green.
