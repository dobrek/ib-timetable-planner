# Disambiguate Palette Drag — Single Course from Palette Implementation Plan

## Overview

The palette today exposes two visually identical drag affordances per `GroupingBox`: a grip on
the header (drags the whole group) and a grip on every member row (drags that one course). N+1
identical grips with no scope signal is the entire source of the reported confusion. This change
makes the palette unambiguous: **each group box has exactly one gesture (drag the whole box), and an
individual course becomes draggable as a single chip promoted from the leading-course filter.** It
is **UI-only** — no change to the data model, write paths, Astro Actions, DB schema, drag-payload
union, or the <200 ms validation core.

## Current State Analysis

- `PlannerPalette` (`PlannerPalette.tsx:19-43`) renders a `GroupingFilter` over a scrollable list of
  `GroupingBox`es. The leading-course selection (`leadingCourseId`) is held in the palette-local
  `useLeadingFilter` hook and is **purely a rendering concern** — nothing outside the palette reads
  it (`PlannerPalette.tsx:37-43`).
- `GroupingBox` (`GroupingBox.tsx:23-65`) is a `useDraggable<GroupDrag>` with the **header as
  `handleRef`** (only the header drags the group). Each member renders a `PaletteCourse`
  (`GroupingBox.tsx:67-108`), itself a `useDraggable<CourseDrag>` with id
  `palette:${groupingId}:${courseId}`. Both the header and every row render an identical
  `GripVertical` + `cursor-grab`.
- `PaletteCourse` is the **only producer of `CourseDrag` in the app** — grid chips use `PlacementDrag`
  (`SlotCell.tsx:207-211`). Removing the row draggable removes the only `CourseDrag` source; the
  kind-keyed *consumers* (`addCourse` at `PlannerBoard.tsx:86-88`, the `"course"` drop case, the
  `"course"` drag-hint case) stay valid and are the reusable substrate for the new chip.
- The individual-course universe is already computed: `leadingCourseOptions(groupings, names)`
  (`leading-course-options.ts:16-27`) lists every distinct member course with name + group count —
  exactly what the filter dropdown shows. `PlannerPalette` already receives `names` and `hours`
  props, so the selected course's name and hours need no new data.
- `catalog` (`GroupingCourse[]`, the grouping-independent superset including ungrouped courses) is
  **not** passed to `PlannerPalette` and will **not** be added — see the singles-universe decision.
- Drag feedback already handles a single chip: `isOverlayKind` excludes `"course"`
  (`GroupDragOverlay.tsx:59-62`) so a `CourseDrag` uses default source-element feedback, and the
  global `Feedback.configure({ dropAnimation: null })` (`PlannerBoard.tsx:259-261`) already covers
  copy-from-palette drags — so the promoted chip needs no overlay treatment.
- **Testing pattern:** pure `model/` logic is unit-tested co-located; there are **zero `.test.tsx`
  files** in the slice — UI components are verified manually. This change adds no new pure logic, so
  verification is lint/steiger/build + manual drag checks.

## Desired End State

- Each multi-member group box has **one** drag gesture: grab anywhere on the box to drag the whole
  group (header retains a single grip as the only draggability hint; member rows are display-only
  name + hours, not draggable).
- Selecting a leading course pins that course as a **draggable single chip as the first item of the
  palette list**, above the filtered group boxes. Dragging it places exactly that course
  (`CourseDrag → addCourse`). Clearing the filter removes the chip.
- A **1-member grouping renders as a chip** (not a box), reusing the shared chip presentation, and
  drags as a whole (`GroupDrag → addGroup([member])`, unchanged).
- The visual language is coherent: **chip = a single placeable course** (promoted chip + singleton
  groupings); **box = a multi-course group**.
- `pnpm build`, `pnpm lint`, `pnpm steiger`, and the existing `pnpm test` suite stay green.

### Key Discoveries:

- The dual drag is unambiguous *mechanically* — dnd-kit binds `pointerdown` to `source.handle ??
  source.element` per draggable (`research.md` Architecture Insights). The fix is visual, not a race.
- Removing the nested row draggables also **eliminates** the flagged pre-1.0 nested-draggable
  mis-capture risk entirely (no more nested draggables inside a box).
- `single:${courseId}` is a collision-free id for the promoted chip once rows
  (`palette:${groupingId}:${courseId}`) are gone (`research.md:178`).
- Foundational principle to preserve: "the course is the unit; the group is a hint + bulk-drop
  convenience" — keep `CourseDrag → addCourse` and `GroupDrag → addGroup` both working
  (`research.md:110-132`).

## What We're NOT Doing

- **No model / write-path / Action / DB / schema change.** `DragData`, `addCourse`, `addGroup`,
  `dropGroup`, `drop-hints`, and the constraint core are untouched.
- **No `catalog` prop on the palette.** Only the *selected* leading course is promoted; the singles
  universe is `leadingCourseOptions` (courses in ≥1 grouping), not all plan courses. To stage a
  different single, the user re-selects the leading course (accepted trade-off).
- **No always-present singles section** (research Option B), no in-box drag-out affordance (Option C),
  no helper text / label rename / empty-state placeholder. The chip's grip icon is the only
  affordance signal; before a course is selected there is no chip and no other prompt.
- **No new overlay component.** The promoted chip uses default source-element feedback; singleton
  groupings keep the existing `GroupDragOverlay` clone.
- **No searchable combobox / clear-button rework** of the filter (already out of scope per the
  leading-course-filter change).

## Implementation Approach

Ship additive-first to avoid any regression in the intermediate state:

1. **Phase 1 (additive):** introduce the promoted single-course chip and a shared chip presentation.
   Group-box rows still drag, so single-course placement is never unavailable. After this phase both
   the chip and rows can place a single — redundant but not broken.
2. **Phase 2 (subtractive + restyle):** make group boxes whole-only (remove row draggables → rows
   become display-only), make the whole box the drag activator, and render singleton groupings as
   chips reusing Phase 1's presentation. The chip is now the sole single-course producer; the
   N-identical-grips problem is gone.

All edits stay within `src/_pages/plan-detail/ui/*` importing the slice's own `model/*` and
`@/shared/*` — downward-only, no steiger risk; pure client-side rendering over already-loaded props,
no Workers-runtime or validation-budget concern.

## Critical Implementation Details

- **Whole-box draggable removes the handle.** Today `useDraggable<GroupDrag>` returns `{ ref,
  handleRef, isDragging }` with `ref` on the box and `handleRef` on the header. Dropping `handleRef`
  and keeping only `ref` on the outer box makes the entire box the activator (dnd-kit uses
  `source.element` when no handle is set). Apply `cursor-grab active:cursor-grabbing` to the box.
  Because member rows are no longer draggable, a pointer-down anywhere in the box now starts the
  group drag — the intended behavior — and there are no nested draggables to mis-capture.
- **Shared chip is presentational only.** The promoted chip (`CourseDrag`, id `single:${courseId}`)
  and the singleton box (`GroupDrag`, id `grouping:${id}`) have different drag wiring but the same
  look. Extract the markup (grip + truncated name + optional hours counter) into one presentational
  component that takes a `ref` (React 19 ref-as-prop, no `forwardRef`) and `isDragging`; each caller
  owns its `useDraggable`. Reuse the existing `isDragging && "opacity-50"` in-place treatment.
- **Singleton drag overlay is left as-is.** A 1-member `GroupDrag` still renders the
  `GroupDragOverlay` `OverlayCard` ("1 courses" + one row). This is transient drag feedback and the
  established group-drag grammar; keep it and confirm it reads acceptably during manual verification
  rather than adding a chip-shaped overlay variant.

## Phase 1: Promote leading course to a draggable single chip

### Overview

Add a shared chip presentation and render the selected leading course as a draggable single-course
chip at the top of the palette list. Additive — group-box rows keep working, so there is no
regression in this phase.

### Changes Required:

#### 1. Shared chip presentation

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx` (extract) → new `src/_pages/plan-detail/ui/PaletteCourseChip.tsx`

**Intent**: Lift the chip markup currently inside `PaletteCourse` (grip + truncated name + hours
counter, with the `isDragging` opacity treatment) into one presentational component so both the
promoted chip and (Phase 2) singleton boxes render identically. The component holds no drag logic.

**Contract**: `PaletteCourseChip({ name, hours, isDragging, ref })` renders a `<div
data-slot="palette-course-chip">` styled with semantic tokens only (`bg-background`, `text-sm`,
`border`, `hover:bg-accent`/`hover:text-accent-foreground`, `cursor-grab`/`active:cursor-grabbing`,
`text-muted-foreground` for the grip). `ref` is forwarded to the root node (React 19 ref-as-prop).
`hours?: HoursStat` renders the existing `placed/required` counter only when present.

#### 2. Promoted leading-course chip

**File**: `src/_pages/plan-detail/ui/PlannerPalette.tsx` (and a small co-located draggable wrapper)

**Intent**: When `leadingCourseId` is set, render a draggable chip for that course as the **first
item** of the scrollable list, above the filtered group boxes. Dragging it emits `CourseDrag` so the
existing `addCourse` drop path places the course.

**Contract**: A draggable wrapper calls `useDraggable<CourseDrag>({ id: `single:${courseId}`, data: {
kind: "course", courseId } })` and renders `PaletteCourseChip` with `name = names[courseId] ??
courseId` and `hours = hours.get(courseId)`. `PlannerPalette` renders it as the first child of the
existing `overflow-y-auto` list container when `leadingCourseId !== null`. No new props on
`PlannerPalette` (`names`, `hours`, `leadingCourseId` all already available).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Existing unit suite stays green: `pnpm test`

#### Manual Verification:

- Selecting a course in the leading-course filter shows a draggable chip as the first item of the
  palette list, above the group boxes; the chip shows the course name, a grip icon, and its
  hours counter.
- Dragging the chip onto a grid cell places that one course (same result as dragging a member row).
- Clearing the filter ("All groupings") removes the chip.
- No regression: group-box rows and the group header still drag as before.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in `## Progress`.

---

## Phase 2: Whole-only group boxes + whole-box drag + chip-style singletons

### Overview

Remove the per-row drag so each group box has one gesture, make the whole box the drag activator, and
render 1-member groupings as chips reusing Phase 1's presentation. After this phase the promoted chip
is the only single-course producer and the N-identical-grips ambiguity is gone.

### Changes Required:

#### 1. Whole-only, whole-box-draggable group box; display-only member rows

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx`

**Intent**: Remove the `PaletteCourse` draggable; member rows become display-only (name + hours, no
grip, no grab cursor, not draggable). Make the entire box the drag activator instead of the header,
keeping a single grip in the header as the only draggability hint.

**Contract**: Drop `handleRef` from the `useDraggable<GroupDrag>` destructure; keep `ref` on the
outer box `<div>` and add `cursor-grab active:cursor-grabbing` to it. The header keeps its single
`GripVertical` + `{N} courses` + students counter but is no longer a separate handle. Member rows
render as a display-only list (`name` + optional hours counter) — no `useDraggable`, no grip, no
hover-accent/grab styling. Removes the only remaining `CourseDrag`-from-rows producer. Semantic
tokens only.

#### 2. Chip-style singleton groupings

**File**: `src/_pages/plan-detail/ui/GroupingBox.tsx`

**Intent**: When a grouping has exactly one member, render it as a `PaletteCourseChip` instead of the
box+row layout, so singles read as chips while multi-course groups read as boxes. Dragging it is
unchanged (`GroupDrag → dropGroup → addGroup([member])`).

**Contract**: For `grouping.memberIds.length === 1`, the `useDraggable<GroupDrag>` `ref`/`isDragging`
drive a `PaletteCourseChip` (member name from `names`, hours from `hours.get(memberId)`) rather than
the header+`<ul>` markup. Multi-member groupings keep the box layout from change #1. Drag id stays
`grouping:${id}` and payload stays `{ kind: "grouping", groupingId }`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Existing unit suite stays green: `pnpm test`

#### Manual Verification:

- Member rows inside a multi-member box are no longer draggable (pointer-down on a row drags the
  whole group, not the single course); rows show name + hours with no grip.
- Grabbing anywhere on a multi-member box drags the whole group; dropping it still fans one placement
  per member into the cell.
- A 1-member grouping renders as a chip (matching the promoted chip style) and drags to place its one
  course.
- The only way to place a single non-singleton course is the promoted chip; the only grip per box is
  the header grip.
- The singleton drag overlay (`GroupDragOverlay` "1 courses" clone) reads acceptably during drag.
- No console errors; drag-cancel (Escape / drop in void) leaves placements unchanged.

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation that the manual testing was successful. Phase blocks use plain bullets — the
`- [ ]` checkboxes live in `## Progress`.

---

## Testing Strategy

### Unit Tests:

- No new pure `model/` logic is introduced (the chip's data is a trivial `names`/`hours` lookup over
  already-tested inputs), so no new Vitest files are added — consistent with the slice having zero
  `.test.tsx` files. The existing `leading-course-options.test.ts` and the rest of the suite must
  continue to pass (regression guard).

### Integration Tests:

- None. No write path, Action, loader, or schema changes, so the integration harness is unaffected.

### Manual Testing Steps:

1. Open a plan with computed groupings. Confirm no chip shows while the filter reads "All groupings".
2. Select a leading course → a chip appears as the first list item; drag it to a cell → the course
   places; confirm the cell's hours/collision behavior matches a row-dragged placement.
3. Clear the filter → the chip disappears.
4. Grab a multi-member box anywhere → the whole group drags and fans into the target cell.
5. Try to drag a member row → it drags the whole group (rows are display-only).
6. Find/select a course that forms a 1-member grouping → confirm that grouping renders as a chip and
   drags to place its one course.
7. Drag and press Escape mid-drag → no placement changes; repeat dropping outside the grid.

## Performance Considerations

Rendering one extra palette item (the promoted chip) and restyling boxes is render cost, not
validation cost; placement still flows through the same single-row insert. No impact on the <200 ms
drag-drop budget.

## Migration Notes

None — UI-only, no persisted data or schema affected.

## References

- Research: `context/changes/dnd-single-course-from-palette/research.md`
- Plan brief: `context/changes/dnd-single-course-from-palette/plan-brief.md`
- Palette container: `src/_pages/plan-detail/ui/PlannerPalette.tsx:19-43`
- Group box (dual drag): `src/_pages/plan-detail/ui/GroupingBox.tsx:23-108`
- Leading-course filter: `src/_pages/plan-detail/ui/GroupingFilter.tsx:39-87`
- Drop handler / `addCourse` / `addGroup`: `src/_pages/plan-detail/ui/PlannerBoard.tsx:85-105`
- Drag-overlay kinds: `src/_pages/plan-detail/ui/GroupDragOverlay.tsx:20-62`
- Lessons (semantic tokens): `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Promote leading course to a draggable single chip

#### Automated

- [x] 1.1 Type checking passes: `pnpm build`
- [x] 1.2 Linting passes: `pnpm lint`
- [x] 1.3 FSD structure check passes: `pnpm steiger`
- [x] 1.4 Existing unit suite stays green: `pnpm test`

#### Manual

- [x] 1.5 Selecting a course shows a draggable chip as the first list item with name, grip, and hours
- [x] 1.6 Dragging the chip places that one course
- [x] 1.7 Clearing the filter removes the chip
- [x] 1.8 No regression: group-box rows and header still drag

### Phase 2: Whole-only group boxes + whole-box drag + chip-style singletons

#### Automated

- [ ] 2.1 Type checking passes: `pnpm build`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 FSD structure check passes: `pnpm steiger`
- [ ] 2.4 Existing unit suite stays green: `pnpm test`

#### Manual

- [ ] 2.5 Member rows are display-only (drag the whole group, not the single course); rows show name + hours, no grip
- [ ] 2.6 Grabbing anywhere on a multi-member box drags the whole group and fans into the cell
- [ ] 2.7 A 1-member grouping renders as a chip and drags to place its one course
- [ ] 2.8 The promoted chip is the only single-course producer; one grip per box (header)
- [ ] 2.9 Singleton drag overlay reads acceptably; drag-cancel leaves placements unchanged
